/**
 * Message Rating Component
 * 
 * Add star rating to each message for collecting training data
 */

import { useState } from "react";
import { Star, Brain, Zap, TrendingUp, Activity, Loader2, Database } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface MessageRatingProps {
  messageId: number;
  currentRating?: number;
}

export function MessageRating({ messageId, currentRating }: MessageRatingProps) {
  const [rating, setRating] = useState(currentRating || 0);
  const [hoveredStar, setHoveredStar] = useState(0);

  const rateMessage = trpc.training.rateMessage.useMutation({
    onSuccess: () => {
      toast.success("Rating saved! This helps JARVIS learn.");
    },
  });

  const handleRate = (stars: number) => {
    setRating(stars);
    rateMessage.mutate({ messageId, rating: stars });
  };

  return (
    <div className="flex items-center gap-1 mt-2">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => handleRate(star)}
          onMouseEnter={() => setHoveredStar(star)}
          onMouseLeave={() => setHoveredStar(0)}
          className="transition-transform hover:scale-110"
        >
          <Star
            className={`w-4 h-4 ${
              star <= (hoveredStar || rating)
                ? "fill-yellow-400 text-yellow-400"
                : "text-gray-300"
            }`}
          />
        </button>
      ))}
      {rating > 0 && (
        <span className="text-xs text-muted-foreground ml-2">
          {rating === 5 && "Perfect! 🎯"}
          {rating === 4 && "Great! 👍"}
          {rating === 3 && "Good"}
          {rating === 2 && "Okay"}
          {rating === 1 && "Needs work"}
        </span>
      )}
    </div>
  );
}

/**
 * Training Dashboard Component
 * 
 * Shows training stats and controls
 */

export function TrainingDashboard() {
  const { data: stats, refetch } = trpc.training.getStats.useQuery();
  const trainModel = trpc.training.trainNewModel.useMutation({
    onSuccess: () => {
      toast.success("Model training started! Check back in a few hours.");
      refetch();
    },
  });
  const trainSpecialized = trpc.training.trainSpecialized.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.specialty} model training started!`);
      refetch();
    },
  });
  const generateFromSources = trpc.training.generateFromSources.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Generated ${result.inserted} training examples from sources (${result.skipped} skipped)`
      );
      refetch();
    },
    onError: (err) => {
      toast.error(`Generation failed: ${err.message}`);
    },
  });

  if (!stats) return <div>Loading...</div>;

  const readyToTrain = stats.totalExamples >= 100;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            Training Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            JARVIS learns from your highly-rated responses
          </p>
        </div>
      </div>

      {/* Training Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium">Total Examples</span>
          </div>
          <p className="text-2xl font-bold">{stats.totalExamples}</p>
          <Progress 
            value={(stats.totalExamples / 1000) * 100} 
            className="mt-2 h-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {1000 - stats.totalExamples} until optimal
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-medium">Current Model</span>
          </div>
          <p className="text-lg font-mono">{stats.currentModel}</p>
          <Badge variant="secondary" className="mt-2">
            {stats.lastTrained 
              ? `Trained ${new Date(stats.lastTrained).toLocaleDateString()}`
              : "Never trained"}
          </Badge>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-sm font-medium">By Rating</span>
          </div>
          {Object.entries(stats.byRating).map(([rating, count]) => (
            <div key={rating} className="flex items-center justify-between text-xs">
              <span>{"⭐".repeat(Number(rating))}</span>
              <span className="text-muted-foreground">{count}</span>
            </div>
          ))}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-medium">By Category</span>
          </div>
          {Object.entries(stats.byCategory).map(([category, count]) => (
            <div key={category} className="flex items-center justify-between text-xs">
              <span className="capitalize">{category}</span>
              <span className="text-muted-foreground">{count}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Learn From Sources */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              Learn From Scraped Sources
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Convert knowledge chunks from your scrape sources into synthetic Q/A training
              examples. Each chunk is used at most once.
            </p>
          </div>
          <Button
            onClick={() => generateFromSources.mutate({ limit: 50 })}
            disabled={generateFromSources.isPending}
            className="gap-2 flex-shrink-0"
          >
            {generateFromSources.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Database className="w-4 h-4" /> Generate from Sources
              </>
            )}
          </Button>
        </div>
        {generateFromSources.data && (
          <div className="mt-2 text-xs text-muted-foreground font-mono bg-secondary/50 rounded px-2 py-1">
            Last run: {generateFromSources.data.inserted} inserted ·{" "}
            {generateFromSources.data.skipped} skipped ·{" "}
            {generateFromSources.data.attempted} attempted
          </div>
        )}
      </Card>

      {/* Training Actions */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Train New Models</h3>

        {!readyToTrain && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-4">
            <p className="text-sm text-amber-400">
              ⚠️ Need at least 100 high-quality examples to train. 
              Current: {stats.totalExamples}/100
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Rate more responses with 4-5 stars to collect training data!
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* General Model */}
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2">General Purpose Model</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Trained on all your interactions
            </p>
            <Button
              onClick={() => trainModel.mutate()}
              disabled={!readyToTrain || trainModel.isPending}
              className="w-full"
            >
              {trainModel.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Training...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Train General Model
                </>
              )}
            </Button>
          </div>

          {/* iOS Specialist */}
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2">iOS Specialist</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Swift, SwiftUI, UIKit expert
            </p>
            <Button
              onClick={() => trainSpecialized.mutate({ specialty: "ios" })}
              disabled={!readyToTrain || trainSpecialized.isPending}
              variant="outline"
              className="w-full"
            >
              <Brain className="w-4 h-4 mr-2" />
              Train iOS Model
            </Button>
          </div>

          {/* Web Specialist */}
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2">Web Specialist</h4>
            <p className="text-sm text-muted-foreground mb-4">
              React, Node.js, TypeScript expert
            </p>
            <Button
              onClick={() => trainSpecialized.mutate({ specialty: "web" })}
              disabled={!readyToTrain || trainSpecialized.isPending}
              variant="outline"
              className="w-full"
            >
              <Brain className="w-4 h-4 mr-2" />
              Train Web Model
            </Button>
          </div>

          {/* Data Specialist */}
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2">Data Specialist</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Python, pandas, data analysis
            </p>
            <Button
              onClick={() => trainSpecialized.mutate({ specialty: "data" })}
              disabled={!readyToTrain || trainSpecialized.isPending}
              variant="outline"
              className="w-full"
            >
              <Brain className="w-4 h-4 mr-2" />
              Train Data Model
            </Button>
          </div>
        </div>

        <div className="mt-4 p-4 bg-muted rounded-lg">
          <h4 className="font-semibold text-sm mb-2">How Training Works</h4>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>JARVIS collects your 4-5 star rated responses</li>
            <li>Exports training data (instruction + output pairs)</li>
            <li>Fine-tunes LLaMA model using LoRA (2-6 hours)</li>
            <li>A/B tests new model vs current model</li>
            <li>Automatically deploys if new model performs better</li>
            <li>Your JARVIS gets smarter every week!</li>
          </ol>
        </div>
      </Card>
    </div>
  );
}
