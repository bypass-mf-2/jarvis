import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";

const AVAILABLE_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel (Female, American)" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi (Female, American)" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella (Female, American)" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni (Male, American)" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli (Female, American)" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh (Male, American)" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold (Male, American)" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam (Male, American)" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam (Male, American)" },
];

export function VoiceSettings() {
  const [selectedVoice, setSelectedVoice] = useState(AVAILABLE_VOICES[0].id);
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);

  // Load saved settings on mount
  const { data: savedSettings } = trpc.settings.getVoiceSettings.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // Apply saved settings when loaded
  useEffect(() => {
    if (savedSettings) {
      setSelectedVoice(savedSettings.voiceId);
      setStability(savedSettings.stability);
      setSimilarityBoost(savedSettings.similarityBoost);
    }
  }, [savedSettings]);

  const saveSettings = trpc.settings.saveVoiceSettings.useMutation({
    onSuccess: () => {
      toast.success("Voice settings saved!");
    },
  });

  const testVoice = trpc.voice.testVoice.useMutation({
    onSuccess: (result) => {
      // Play the audio
      const audio = new Audio(result.audioUrl);
      audio.play();
      toast.success("Playing voice sample");
    },
  });

  const handleSave = () => {
    saveSettings.mutate({
      voiceId: selectedVoice,
      stability,
      similarityBoost,
    });
  };

  const handleTest = () => {
    testVoice.mutate({
      voiceId: selectedVoice,
      text: "Hello Trevor, this is a test of the voice you selected. How does it sound?",
      stability,
      similarityBoost,
    });
  };

  return (
    <Card className="p-6">
      <h2 className="text-xl font-bold mb-4">Voice Settings</h2>

      <div className="space-y-6">
        {/* Voice Selection */}
        <div>
          <Label>Voice</Label>
          <Select value={selectedVoice} onValueChange={setSelectedVoice}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_VOICES.map((voice) => (
                <SelectItem key={voice.id} value={voice.id}>
                  {voice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stability */}
        <div>
          <Label>Stability: {stability.toFixed(2)}</Label>
          <Slider
            value={[stability]}
            onValueChange={([v]) => setStability(v)}
            min={0}
            max={1}
            step={0.05}
            className="mt-2"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Higher = more stable and consistent
          </p>
        </div>

        {/* Similarity Boost */}
        <div>
          <Label>Similarity Boost: {similarityBoost.toFixed(2)}</Label>
          <Slider
            value={[similarityBoost]}
            onValueChange={([v]) => setSimilarityBoost(v)}
            min={0}
            max={1}
            step={0.05}
            className="mt-2"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Higher = more similar to original voice
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button onClick={handleTest} variant="outline" disabled={testVoice.isPending}>
            {testVoice.isPending ? "Testing..." : "Test Voice"}
          </Button>
          <Button onClick={handleSave} disabled={saveSettings.isPending}>
            {saveSettings.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </Card>
  );
}