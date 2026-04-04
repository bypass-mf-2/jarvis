import { trpc } from "@/lib/trpc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Brain, User, MapPin, Building } from "lucide-react";

export function MemoryViewer() {
  const { data: facts } = trpc.memory.getFacts.useQuery({ limit: 50 });
  const { data: entities } = trpc.memory.getEntities.useQuery({ limit: 30 });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          Persistent Memory
        </h3>
        <p className="text-xs text-muted-foreground">
          Everything JARVIS remembers about you
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Facts */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Facts About Trevor</h4>
            <div className="space-y-2">
              {(facts || []).map((fact: any) => (
                <div key={fact.id} className="p-3 rounded-lg border bg-card text-xs">
                  <div className="flex items-start justify-between mb-1">
                    <Badge variant="outline" className="text-xs">
                      {fact.category}
                    </Badge>
                    <span className="text-muted-foreground">
                      {(parseFloat(fact.confidence) * 100).toFixed(0)}% confident
                    </span>
                  </div>
                  <p className="text-foreground">{fact.fact}</p>
                  <p className="text-muted-foreground mt-1">
                    Referenced {fact.timesReferenced} times
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Entities */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Known Entities</h4>
            <div className="space-y-2">
              {(entities || []).map((entity: any) => {
                const Icon = 
                  entity.type === "person" ? User :
                  entity.type === "place" ? MapPin :
                  entity.type === "organization" ? Building :
                  Brain;

                return (
                  <div key={entity.id} className="p-3 rounded-lg border bg-card text-xs">
                    <div className="flex items-start gap-2">
                      <Icon className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold">{entity.name}</p>
                        <p className="text-muted-foreground">{entity.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {entity.type}
                          </Badge>
                          <span className="text-muted-foreground">
                            Mentioned {entity.mentionCount} times
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}