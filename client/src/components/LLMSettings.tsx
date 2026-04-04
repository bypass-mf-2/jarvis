import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Settings, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function LLMSettings() {
  const { data: settings, refetch } = trpc.llm.getSettings.useQuery();
  const { data: presets } = trpc.llm.getPresets.useQuery();
  const setSetting = trpc.llm.setSetting.useMutation({
    onSuccess: () => {
      toast.success("Setting updated");
      refetch();
    },
  });
  const applyPreset = trpc.llm.applyPreset.useMutation({
    onSuccess: () => {
      toast.success("Preset applied");
      refetch();
    },
  });

  const [localSettings, setLocalSettings] = useState<any>({});

  const updateSetting = (name: string, value: string) => {
    setLocalSettings({ ...localSettings, [name]: value });
    setSetting.mutate({ name, value });
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-6">
        {/* Presets */}
        <div>
          <Label className="text-sm font-semibold mb-2 block">Quick Presets</Label>
          <div className="grid grid-cols-2 gap-2">
            {presets && Object.entries(presets).map(([name, preset]: [string, any]) => (
              <Button
                key={name}
                variant="outline"
                size="sm"
                onClick={() => applyPreset.mutate({ preset: name })}
                disabled={applyPreset.isPending}
                className="justify-start text-xs"
              >
                <Zap className="w-3 h-3 mr-2" />
                {name}
              </Button>
            ))}
          </div>
        </div>

        {/* Model Selection */}
        <div>
          <Label className="text-sm font-semibold mb-2 block">Model</Label>
          <Select
            value={settings?.default_model || "llama3.2"}
            onValueChange={(v) => updateSetting("default_model", v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="llama3.2">LLaMA 3.2 (Fast)</SelectItem>
              <SelectItem value="llama3.1">LLaMA 3.1 (Larger)</SelectItem>
              <SelectItem value="mistral">Mistral (Balanced)</SelectItem>
              <SelectItem value="codellama">Code LLaMA (Coding)</SelectItem>
              <SelectItem value="llama3.1:70b">LLaMA 3.1 70B (Best)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Temperature */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-semibold">Temperature</Label>
            <Badge variant="secondary" className="text-xs">
              {settings?.temperature || 0.7}
            </Badge>
          </div>
          <Slider
            value={[parseFloat(settings?.temperature || "0.7") * 100]}
            min={0}
            max={100}
            step={5}
            onValueChange={([v]) => updateSetting("temperature", (v / 100).toFixed(2))}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Higher = more creative, Lower = more focused
          </p>
        </div>

        {/* Max Tokens */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-semibold">Max Response Length</Label>
            <Badge variant="secondary" className="text-xs">
              {settings?.max_tokens || 2048} tokens
            </Badge>
          </div>
          <Slider
            value={[parseInt(settings?.max_tokens || "2048")]}
            min={512}
            max={8192}
            step={512}
            onValueChange={([v]) => updateSetting("max_tokens", v.toString())}
            className="w-full"
          />
        </div>

        {/* RAG Settings */}
        <div>
          <Label className="text-sm font-semibold mb-2 block">RAG (Retrieval)</Label>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs">Enable RAG</span>
              <input
                type="checkbox"
                checked={settings?.rag_enabled === "true"}
                onChange={(e) => updateSetting("rag_enabled", e.target.checked.toString())}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs">Results per query</span>
                <Badge variant="secondary" className="text-xs">
                  {settings?.rag_top_k || 5}
                </Badge>
              </div>
              <Slider
                value={[parseInt(settings?.rag_top_k || "5")]}
                min={1}
                max={20}
                step={1}
                onValueChange={([v]) => updateSetting("rag_top_k", v.toString())}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Memory Settings */}
        <div>
          <Label className="text-sm font-semibold mb-2 block">Memory</Label>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs">Enable Memory</span>
              <input
                type="checkbox"
                checked={settings?.memory_enabled === "true"}
                onChange={(e) => updateSetting("memory_enabled", e.target.checked.toString())}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Auto-extract facts</span>
              <input
                type="checkbox"
                checked={settings?.memory_auto_extract === "true"}
                onChange={(e) => updateSetting("memory_auto_extract", e.target.checked.toString())}
              />
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}