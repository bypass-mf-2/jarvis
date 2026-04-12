import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  ArrowLeft,
  Search,
  Brain,
  Loader2,
  Waypoints,
} from "lucide-react";
import ForceGraph2D from "react-force-graph-2d";

// ─── Color map for entity types ─────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  person: "#f97316",       // orange
  organization: "#3b82f6", // blue
  technology: "#22c55e",   // green
  legal: "#ef4444",        // red
  historical: "#d97706",   // amber
  named_entity: "#a855f7", // purple
  concept: "#eab308",      // yellow
  unknown: "#6b7280",      // gray
};

function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? TYPE_COLORS.unknown;
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function KnowledgeGraph() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeEntity, setActiveEntity] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const graphRef = useRef<any>(null);

  const { data: stats } = trpc.systemStatus.graphStats.useQuery();

  const {
    data: graphData,
    isFetching,
    refetch,
  } = trpc.systemStatus.exploreGraph.useQuery(
    { entity: activeEntity ?? "", depth },
    { enabled: !!activeEntity }
  );

  const doSearch = useCallback(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      toast.error("Enter at least 2 characters");
      return;
    }
    setActiveEntity(q);
  }, [searchQuery]);

  // Center the graph on the root node when data arrives
  useEffect(() => {
    if (graphData && graphData.rootEntity && graphRef.current) {
      setTimeout(() => {
        graphRef.current?.zoomToFit(400, 60);
      }, 500);
    }
  }, [graphData]);

  // Click a node → explore it
  const handleNodeClick = useCallback((node: any) => {
    setSearchQuery(node.name || node.id);
    setActiveEntity(node.id);
  }, []);

  // Format graph data for ForceGraph2D
  const fgData = graphData
    ? {
        nodes: graphData.nodes.map((n: any) => ({
          ...n,
          val: Math.max(3, Math.log2((n.mentions || 1) + 1) * 3), // size by mentions
          color: typeColor(n.type),
        })),
        links: graphData.links.map((l: any) => ({
          ...l,
          value: Math.max(0.5, Math.log2((l.strength || 1) + 1)),
        })),
      }
    : { nodes: [], links: [] };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3"
        style={{ background: "oklch(0.10 0.016 240 / 0.8)" }}>
        <Link href="/">
          <Button variant="ghost" size="icon" aria-label="Back to chat">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <Waypoints className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h1 className="text-sm font-semibold tracking-widest text-primary">
            KNOWLEDGE GRAPH
          </h1>
          {stats && (
            <p className="text-xs text-muted-foreground">
              {stats.entities.toLocaleString()} entities · {stats.relationshipPairs.toLocaleString()} connections · {stats.chunkLinks.toLocaleString()} chunk links
            </p>
          )}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search entity (e.g., Hitler, Python, Tesla)"
            className="w-64 text-sm"
          />
          <Button size="sm" onClick={doSearch} disabled={isFetching}>
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
          <select
            value={depth}
            onChange={(e) => {
              setDepth(parseInt(e.target.value));
              if (activeEntity) setTimeout(() => refetch(), 0);
            }}
            className="h-9 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value={1}>1 hop</option>
            <option value={2}>2 hops</option>
            <option value={3}>3 hops</option>
          </select>
        </div>
      </div>

      {/* ── Graph area ───────────────────────────────────────────── */}
      <div className="relative flex-1">
        {!activeEntity ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <Brain className="h-16 w-16 opacity-30" />
            <p className="text-sm">Search for an entity to explore the knowledge graph</p>
            <div className="flex flex-wrap gap-2">
              {["Hitler", "Python", "Machine Learning", "Tesla", "Cybersecurity", "React", "Neural Network"].map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchQuery(suggestion);
                    setActiveEntity(suggestion);
                  }}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        ) : fgData.nodes.length === 0 && !isFetching ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <p>No entities found for "{activeEntity}"</p>
            <p className="text-xs">Try a different search term</p>
          </div>
        ) : (
          <>
            <ForceGraph2D
              ref={graphRef}
              graphData={fgData}
              nodeLabel={(node: any) =>
                `${node.name} (${node.type}, ${node.mentions} mentions)`
              }
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const label = node.name || node.id;
                const fontSize = Math.max(10, 12 / globalScale);
                const nodeR = node.val || 4;
                const isRoot = node.id === graphData?.rootEntity;

                // Node circle
                ctx.beginPath();
                ctx.arc(node.x, node.y, nodeR, 0, 2 * Math.PI);
                ctx.fillStyle = node.color || "#6b7280";
                ctx.fill();

                if (isRoot) {
                  ctx.strokeStyle = "#ffffff";
                  ctx.lineWidth = 2 / globalScale;
                  ctx.stroke();
                }

                // Label
                ctx.font = `${isRoot ? "bold " : ""}${fontSize}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "rgba(255,255,255,0.9)";
                ctx.fillText(label, node.x, node.y + nodeR + fontSize);
              }}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                const nodeR = node.val || 4;
                ctx.beginPath();
                ctx.arc(node.x, node.y, nodeR + 5, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkWidth={(link: any) => Math.max(0.3, link.value || 0.5)}
              linkColor={() => "rgba(100, 150, 255, 0.2)"}
              linkDirectionalParticles={0}
              onNodeClick={handleNodeClick}
              backgroundColor="oklch(0.08 0.015 240)"
              cooldownTicks={100}
              d3VelocityDecay={0.3}
            />

            {/* Legend */}
            <div className="absolute bottom-4 left-4 rounded-lg border border-border bg-background/80 p-3 backdrop-blur-sm">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Entity types</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(TYPE_COLORS).map(([type, color]) => (
                  <div key={type} className="flex items-center gap-1.5">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs capitalize">{type.replace("_", " ")}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Click any node to explore its connections.
                Node size = mention count. Edge thickness = co-occurrence strength.
              </p>
            </div>

            {/* Active entity info card */}
            {graphData && graphData.rootEntity && (
              <div className="absolute right-4 top-4 w-64 rounded-lg border border-border bg-background/80 p-3 backdrop-blur-sm">
                <div className="mb-1 text-sm font-medium">
                  {graphData.nodes.find((n: any) => n.id === graphData.rootEntity)?.name ?? activeEntity}
                </div>
                <div className="text-xs text-muted-foreground">
                  {graphData.nodes.length} nodes · {graphData.links.length} edges · depth {depth}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {graphData.nodes
                    .filter((n: any) => n.id !== graphData.rootEntity)
                    .sort((a: any, b: any) => (b.mentions || 0) - (a.mentions || 0))
                    .slice(0, 8)
                    .map((n: any) => (
                      <Badge
                        key={n.id}
                        variant="outline"
                        className="cursor-pointer text-xs hover:bg-primary/10"
                        style={{ borderColor: typeColor(n.type) + "60", color: typeColor(n.type) }}
                        onClick={() => {
                          setSearchQuery(n.name);
                          setActiveEntity(n.id);
                        }}
                      >
                        {n.name}
                      </Badge>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
