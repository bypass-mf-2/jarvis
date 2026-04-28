import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createConversation,
  getConversations,
  getConversationById,
  getMessages,
  addMessage,
  updateConversationTitle,
  deleteConversation,
  getKnowledgeChunks,
  countKnowledgeChunks,
  deleteKnowledgeChunk,
  getActivityRates,
  addScrapeSource,
  getScrapeSources,
  toggleScrapeSource,
  deleteScrapeSource,
  getSystemLogs,
  getPatches,
  updatePatchStatus,
  getLearnedFacts,
  searchLearnedFacts,
  getEntityMemory,
  searchEntityMemory,
  getMessageById,
  updateMessageRating,
  updateMessageContent,
  deleteMessageById,
  deleteMessagesFromId,
  getLastActiveMessage,
  deactivateSubtree,
  activateSubtree,
  switchToBranch,
  getBranchInfo,
  getMessageChildren,
  getAllMessages,
  getTokenStats,
  estimateTokens,
  getMessagesBeforeId,
  createFolder,
  getFolders,
  updateFolder,
  deleteFolder,
  moveConversationToFolder,
} from "./db";
import {
  analyzeWritingStyle,
  loadVoiceProfile,
  writeInTrevorsVoice,
} from "./voicelearning.js";
import {
  getGraphStats as getEntityGraphStats,
  searchEntitiesInGraph,
  getRelatedEntitiesFromGraph,
} from "./entityExtractor.js";
import { analyzeKnowledge } from "./knowledgeAnalysis.js";
import {
  startSelfEvaluation,
  getPlan as getSelfEvalPlan,
  cancelEvaluation,
  updatePlanItem,
  clearPlan as clearSelfEvalPlan,
} from "./selfEvaluate.js";
import {
  listSamples as listWritingSamplesModule,
  getProfile as getWritingProfileModule,
  regenerateWritingProfile,
  regenerateProfileForCategory as regenerateProfileForCategoryModule,
  deleteWritingSample as deleteWritingSampleModule,
  updateSampleCategory as updateWritingSampleCategoryModule,
  listProfileCategories as listProfileCategoriesModule,
} from "./writingProfile.js";
import {
  startNavigationTask,
  getRun as getNavRun,
  listRuns as listNavRuns,
  stopTask as stopNavTask,
  resolvePendingAction as resolveNavPending,
  resolveTypedConfirmation as resolveNavTyped,
  beginCaptureSession,
  finalizeCaptureSession,
  cancelCaptureSession,
  listSessions as listNavSessions,
  deleteSession as deleteNavSession,
} from "./navigator.js";
import { listNavAuditLog } from "./db";
import { logger } from "./logger";
import { ragChat } from "./rag";
import { applyConfidenceGate, computeConfidenceStats } from "./confidenceGate.js";
import {
  getMetaSettings,
  setConfidenceThreshold,
  setAutonomyEnabled,
  setOfflineMode,
} from "./metaSettings.js";
import {
  getAutonomyStatus,
  runTickNow as runAutonomyTickNow,
} from "./autonomousLoop.js";
import {
  runTrainingCycle,
  listTrainingRuns,
  getLoraConfig,
} from "./loraTrainer.js";
import { listEvalRuns } from "./loraEval.js";
import {
  runBenchmark,
  listBenchmarkRuns,
  getAvailableDatasets,
} from "./benchmarks.js";
import { scrapeSource, scrapeAllSources, isScraperEnabled, setScraperEnabled } from "./scraper";
import {
  isMediaEnabled,
  setMediaEnabled,
  ingestMediaUrl,
  detectPlatform,
  resolveYouTubeChannelRss,
  scrapeMediaChannels,
  YOUTUBE_CHANNEL_TYPE,
} from "./mediaIngest.js";
import { analyzeSelfForImprovements, safeApplyCodeChange, analyzeImprovementFeed } from "./selfImprovement";
import { readRecentEvents as readImprovementFeed } from "./improvementFeed";
import { isOllamaAvailable, listOllamaModels } from "./ollama";
import { seedDefaultSources } from "./services";
import { transcribeAudio } from "./_core/voiceTranscription";
import { processConversationMemory } from "./persistentMemory.js";
import {
  getAllSettings,
  getSetting,
  setSetting,
  applyPreset,
  PRESETS,
} from "./llmSettings.js";
import {
  recallRelevantFacts,
  recallEntities,
} from "./persistentMemory.js";
import { generateImage } from "./imageGeneration.js";
import {
  getQuote,
  getCompanyOverview,
  getDailyPrices,
  searchSymbol,
  getStockNews,
  analyzeStock,
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
  checkWatchlistAlerts,
  getMarketSummary,
  getAlphaVantageCallStats,
} from "./stockMarket.js";
import {
  runIntegrityCheck,
  getLastReport as getIntegrityReport,
} from "./integrityChecker.js";
import {
  runUnknownScheduler,
  listLearningTargets,
  getLearningTargetsStats,
  resolveTargetByTopic,
} from "./unknownScheduler.js";
import { getEmbedQueueStats } from "./scraper";
import {
  getAccount,
  getPositions,
  getOrders,
  placeTrade,
  cancelOrder,
  closePosition,
  getPendingTrades,
  approveTrade,
  rejectTrade,
  getTradeRecommendation,
  getTradingConfig,
  setTradingMode,
  updateTradingConfig,
  getTradeHistory,
  type TradingMode,
} from "./trading.js";
import {
  createBook,
  updateBook,
  listBooks,
  getBook,
  startWriting as startBookWriting,
  resumeBook,
  submitIntervention as submitBookIntervention,
  unpauseAndWrite as unpauseBook,
  deleteBook,
  exportAsMarkdown as exportBookAsMarkdown,
} from "./bookWriter.js";
import * as path from "path";
import { cloneTrevorsVoice, cloneVoiceElevenLabs } from "./voicecloning.js";
import {
  startVideoProject,
  getVideoProject,
  listVideoProjects,
  cancelVideoProject,
  deleteVideoProject,
} from "./videoGeneration.js";
import { executeCode, testCode } from "./codeExecution.js";
import { generateCode, reviewCode, explainCode, fixCode } from "./codingAI.js";
import { searchWeb, searchAndSummarize } from "./webSearch.js";
import { runWebCrawlCycle, runSourceDiscovery } from "./sourceDiscovery.js";
import {
  collectTrainingExample,
  exportTrainingData,
  trainNewModel,
  trainSpecializedModel,
  getTrainingStats,
  generateTrainingFromChunks,
} from "./autoTrain.js";
import {
  recordCorrection,
  recordConfusion,
  detectHedgeWords,
  getWeaknessTopics,
  scrapeWeakTopics,
  exportCorrectionsForTraining,
  getCorrectionStats,
  listCorrections as listCorrectionRows,
} from "./activeLearning.js";
import { processWithAgentSwarm, getAgentStatus } from "./multiAgent.js";
import { sendNotification, isConfigured as isNotifyConfigured, configureTopic } from "./phoneNotify.js";
import {
  getWeather,
  getCryptoPrice,
  getHeadlines,
  getTimeInZone,
  getRandomFact,
  getDailyQuote,
  getIPInfo,
  defineWord,
  getExchangeRate,
} from "./dataFeeds.js";
import {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  type WebhookAction,
} from "./webhooks.js";
import {
  openApp,
  openUrl,
  openFile,
  listProcesses,
  killProcess,
  getSystemInfo,
  runCommand,
  takeScreenshot,
  setClipboard,
} from "./systemControl.js";
import { createTask, listTasks, deleteTask, updateTask, pauseTask, parseNaturalTime } from "./scheduler.js";
import {
  parseCSV,
  analyzeData,
  filterData,
  sortData,
  groupBy,
  summarize,
  getChartData,
  type FilterCondition,
  type AggregationType,
} from "./csvAnalysis.js";
import {
  trimVideo,
  mergeVideos,
  addSubtitles,
  extractAudio,
  getVideoInfo,
  generateThumbnail,
} from "./videoEditing.js";
import {
  recordReflection,
  reflectOnAction,
  getRecentReflections,
  getReflectionsByType,
  getReflectionStats,
} from "./reflection.js";
import {
  planTask,
  executePlan,
  planAndExecute,
  listTools as listPlannerTools,
  looksLikeMultiStepRequest,
  type Plan,
} from "./planner.js";
import {
  createGoal,
  listGoals,
  getGoal,
  updateGoalStatus,
  updateSubtaskStatus,
  addSubtask,
  deleteGoal,
  deleteSubtask,
  getActiveGoalsContext,
  checkGoalDeadlines,
} from "./goalManager.js";

// ── Chat Router ───────────────────────────────────────────────────────────────
const chatRouter = router({
  listConversations: publicProcedure.query(async ({ ctx }) => {
    return getConversations(ctx.user?.id);
  }),

  getConversation: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const conv = await getConversationById(input.id);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      const msgs = await getMessages(input.id);
      return { conversation: conv, messages: msgs };
    }),

  createConversation: publicProcedure
    .input(z.object({ model: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return createConversation({
        userId: ctx.user?.id,
        model: input.model ?? "llama3.2",
        title: "New Conversation",
      });
    }),

  sendMessage: publicProcedure
    .input(
      z.object({
        conversationId: z.number(),
        content: z.string().min(1).max(8000),
        model: z.string().optional(),
        forceReasoning: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // For branching: new messages get the last active message as their parent.
      // This lets us preserve old branches when the user edits/retries.
      const lastActive = getLastActiveMessage(input.conversationId);
      const userParentId = lastActive?.id ?? null;

      // Save user message
      const userMsg = await addMessage({
        conversationId: input.conversationId,
        role: "user",
        content: input.content,
        parentId: userParentId,
        isActive: 1,
      });
      // Track userMsg.id so subsequent assistant messages can use it as parent
      (input as any)._userMessageId = userMsg.id;

      const lower = input.content.toLowerCase();

      // ── Intent: Image Generation ──────────────────────────────────────
      // Detect "generate/create/draw/make an image/picture/photo of ..."
      const imageMatch = lower.match(
        /(?:generate|create|draw|make|paint|render|design)\s+(?:an?\s+)?(?:image|picture|photo|illustration|artwork|graphic)\s+(?:of|about|depicting|showing|with)\s+(.+)/i
      );
      if (imageMatch) {
        const prompt = input.content.replace(imageMatch[0], imageMatch[1]).trim() || imageMatch[1];
        try {
          const result = await generateImage(prompt);
          const filename = path.basename(result.filepath);
          const imageUrl = `/api/generated-image/${filename}`;
          const response = `Here's the image I generated:\n\n![${prompt}](${imageUrl})\n\n**Prompt:** ${prompt}\n**Provider:** ${result.provider}`;

          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });

          // Auto-title
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) {
            await updateConversationTitle(input.conversationId, `Image: ${prompt.slice(0, 50)}`);
          }

          // Fire-and-forget reflection on the image generation
          try {
            reflectOnAction(
              "generateImage",
              { prompt, provider: result.provider },
              `success: image saved to ${filename} via ${result.provider}`
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}

          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const errorMsg = `I tried to generate that image but it failed: ${String(err)}. Make sure Ollama with a vision model, DALL-E API key, or Stable Diffusion WebUI is available.`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: errorMsg,
          });
          try {
            reflectOnAction(
              "generateImage",
              { prompt },
              `failure: ${String(err)}`
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: Media URL Ingestion ───────────────────────────────────
      // YouTube / TikTok / Instagram links pasted in chat. Runs BEFORE the
      // Navigator intent so "visit https://youtube.com/watch?v=..." routes
      // to ingestion rather than starting a browser session.
      //
      // Only fires when the master toggle is on — otherwise falls through to
      // normal chat (and if the message also matches another intent, that
      // handler runs as usual).
      if (isMediaEnabled()) {
        const urlMatch = input.content.match(/https?:\/\/\S+/i);
        if (urlMatch) {
          const mediaUrl = urlMatch[0].replace(/[.,;!?)]+$/, "");
          const platform = detectPlatform(mediaUrl);
          if (platform !== "unknown") {
            try {
              const result = await ingestMediaUrl(mediaUrl);
              const response = result.ok
                ? `Ingested **${result.title ?? mediaUrl}** from ${platform}. Stored ${result.chunks} chunk${result.chunks === 1 ? "" : "s"} into the knowledge base (source: ${result.source ?? "unknown"}).\n\nYou can now ask me anything about it.`
                : `I tried to ingest that ${platform} URL but it didn't work: ${result.error ?? "unknown error"}`;
              const assistantMsg = await addMessage({
                conversationId: input.conversationId,
                role: "assistant",
                content: response,
              });

              const msgs = await getMessages(input.conversationId);
              if (msgs.length === 2) {
                await updateConversationTitle(
                  input.conversationId,
                  `Ingest: ${(result.title ?? platform).slice(0, 50)}`
                );
              }

              try {
                reflectOnAction(
                  "ingestMediaUrl",
                  { url: mediaUrl, platform },
                  result.ok
                    ? `ingested ${result.chunks} chunks from ${platform}`
                    : `failure: ${result.error}`
                ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
              } catch {}

              return { message: assistantMsg, ragChunksUsed: 0 };
            } catch (err) {
              // Swallow and fall through to regular chat — the user probably
              // just happened to paste a URL in a normal message.
              await logger.warn(
                "media",
                `Chat media ingest fell through: ${String(err)}`
              );
            }
          }
        }
      }

      // ── Intent: Navigator / Browse Website ────────────────────────────
      // Detect "navigate to / go to / browse / open [url/site]" or
      // "use the browser to ..."
      const navMatch = lower.match(
        /(?:navigate\s+to|go\s+to|browse|open\s+(?:the\s+)?(?:website|site|page|url)?|visit)\s+(https?:\/\/\S+|[\w.-]+\.(?:com|org|net|io|dev|edu|gov|co|ai|app)\S*)/i
      ) || lower.match(
        /(?:use\s+(?:the\s+)?(?:browser|navigator)\s+(?:to|and)\s+)(.+)/i
      );
      if (navMatch) {
        const goal = navMatch[1].trim();
        try {
          const taskId = await startNavigationTask({
            goal: input.content,
            allowlist: [],
            maxSteps: 15,
            headless: false,
            highStakes: false,
          });
          const response = `I've started a browser navigation task for you.\n\n**Goal:** ${input.content}\n**Task ID:** ${taskId}\n\nYou can monitor progress on the [Navigator page](/navigator). I'll run in headed mode so you can watch.`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });

          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) {
            await updateConversationTitle(input.conversationId, `Browse: ${goal.slice(0, 50)}`);
          }

          // Fire-and-forget reflection on starting the navigation task
          try {
            reflectOnAction(
              "startNavigationTask",
              { goal: input.content, target: goal },
              `started navigator task ${taskId} for goal: ${goal}`
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}

          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const errorMsg = `I tried to start a browser task but it failed: ${String(err)}`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: errorMsg,
          });
          try {
            reflectOnAction(
              "startNavigationTask",
              { goal: input.content, target: goal },
              `failure: ${String(err)}`
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: Video Generation ──────────────────────────────────────
      // Detect "make/create/generate a video about/from/of ..."
      const videoMatch = lower.match(
        /(?:make|create|generate|produce|build)\s+(?:a\s+|me\s+a\s+)?(?:video|movie|film|clip)\s+(?:about|from|of|on|for|using|based\s+on)\s+(.+)/i
      );
      if (videoMatch) {
        const topic = videoMatch[1].trim();
        // Extract duration if mentioned: "10 minute", "5 min", "2-minute", "30 second"
        const durationMatch = lower.match(/(\d+(?:\.\d+)?)\s*[-]?\s*(?:minute|min|m\b)/);
        const secMatch = !durationMatch ? lower.match(/(\d+)\s*[-]?\s*(?:second|sec|s\b)/) : null;
        let targetMinutes: number | null = null;
        if (durationMatch) targetMinutes = parseFloat(durationMatch[1]);
        else if (secMatch) targetMinutes = parseInt(secMatch[1]) / 60;
        try {
          const videoId = startVideoProject({
            title: topic.slice(0, 100),
            sourceText: input.content,
            style: lower.includes("lecture") ? "lecture"
              : lower.includes("story") ? "story"
              : lower.includes("slideshow") ? "slideshow"
              : "documentary",
            voiceStyle: "trevor",
            targetMinutes,
          });
          const durationInfo = targetMinutes ? `\n**Target Duration:** ${targetMinutes} minutes` : "\n**Duration:** Auto (based on content)";
          const response = `I've started generating a video for you!\n\n**Topic:** ${topic}\n**Project ID:** ${videoId}\n**Style:** ${lower.includes("lecture") ? "Lecture" : lower.includes("story") ? "Story" : lower.includes("slideshow") ? "Slideshow" : "Documentary"}${durationInfo}\n\nThis will take several minutes as I:\n1. Plan the scenes with an AI storyboard\n2. Generate narration audio for each scene\n3. Create images for each scene\n4. Stitch everything into an MP4\n\nYou can check progress by asking me about the video status.`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });

          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) {
            await updateConversationTitle(input.conversationId, `Video: ${topic.slice(0, 50)}`);
          }

          // Fire-and-forget reflection on starting the video project
          try {
            reflectOnAction(
              "startVideoProject",
              { topic, targetMinutes, videoId },
              `started video project ${videoId} on topic: ${topic}`
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}

          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const errorMsg = `I tried to start video generation but it failed: ${String(err)}`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: errorMsg,
          });
          try {
            reflectOnAction(
              "startVideoProject",
              { topic, targetMinutes },
              `failure: ${String(err)}`
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: System Control — open app ────────────────────────────
      const openAppMatch = lower.match(
        /(?:open|launch|start|run)\s+(?:the\s+)?(?:app\s+)?(?:called\s+)?(notepad|chrome|calculator|calc|firefox|edge|paint|wordpad|explorer|cmd|powershell|terminal|vscode|code|spotify|discord|slack|teams|obs|vlc|task\s*manager|taskmgr|snipping|settings)/i
      );
      if (openAppMatch) {
        const appName = openAppMatch[1].trim();
        try {
          const result = await openApp(appName);
          const response = result.success
            ? `Done — I opened **${appName}** for you.`
            : `I tried to open ${appName} but it failed: ${result.message}`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) {
            await updateConversationTitle(input.conversationId, `Open: ${appName}`);
          }
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: `Failed to open ${appName}: ${String(err)}`,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: System Control — run command ─────────────────────────
      const runCmdMatch = lower.match(
        /(?:run|execute)\s+(?:the\s+)?(?:command|cmd|shell)\s*[:\s]+(.+)/i
      );
      if (runCmdMatch) {
        const cmd = input.content.match(
          /(?:run|execute)\s+(?:the\s+)?(?:command|cmd|shell)\s*[:\s]+(.+)/i
        )?.[1]?.trim() || runCmdMatch[1];
        try {
          const result = await runCommand(cmd);
          let response: string;
          if (result.blocked) {
            response = `I blocked that command for safety reasons. The command matched a dangerous pattern.`;
          } else if (result.success) {
            response = `Command executed successfully.\n\n\`\`\`\n${result.stdout || "(no output)"}\n\`\`\`${result.stderr ? `\n\n**Stderr:**\n\`\`\`\n${result.stderr}\n\`\`\`` : ""}`;
          } else {
            response = `Command failed:\n\`\`\`\n${result.stderr || result.stdout}\n\`\`\``;
          }
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) {
            await updateConversationTitle(input.conversationId, `Run: ${cmd.slice(0, 50)}`);
          }
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: `Failed to run command: ${String(err)}`,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: System Control — system info ─────────────────────────
      if (
        /(?:system\s*info|system\s*status|cpu\s*usage|memory\s*usage|disk\s*space|how\s*much\s*(?:ram|memory|disk)|what.*(?:cpu|memory|ram|disk|uptime))/i.test(lower)
      ) {
        try {
          const result = await getSystemInfo();
          const i = result.info;
          const diskLines = i.disks.map((d) => `  - **${d.drive}** ${d.freeGB} GB free / ${d.totalGB} GB (${d.usedPercent}% used)`).join("\n");
          const response = [
            `**System Information**`,
            `- **Host:** ${i.hostname}`,
            `- **OS:** ${i.platform} (${i.arch})`,
            `- **CPU:** ${i.cpuModel} (${i.cpuCores} cores, ${i.cpuUsagePercent}% usage)`,
            `- **Memory:** ${(i.totalMemoryGB - i.freeMemoryGB).toFixed(1)} / ${i.totalMemoryGB} GB used (${i.usedMemoryPercent}%)`,
            `- **Uptime:** ${i.uptimeHours} hours`,
            `- **Disks:**`,
            diskLines,
          ].join("\n");
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) {
            await updateConversationTitle(input.conversationId, "System Info");
          }
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: `Failed to get system info: ${String(err)}`,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: System Control — take screenshot ─────────────────────
      if (/(?:take|capture|grab|snap)\s+(?:a\s+)?screenshot/i.test(lower)) {
        try {
          const result = await takeScreenshot();
          const response = result.success
            ? `Screenshot captured and saved to:\n\`${result.filepath}\``
            : `Screenshot failed: ${result.message}`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) {
            await updateConversationTitle(input.conversationId, "Screenshot");
          }
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: `Screenshot failed: ${String(err)}`,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: Opinion override / set ────────────────────────────────
      // Detects "actually X is Y", "set my view on X to Y", "your opinion
      // about X should be Y", "I disagree about X — Y is true". Stores
      // the user's view as a locked opinion. Future chat sees it in the
      // system prompt and treats it as authoritative.
      const opinionMatch =
        lower.match(/^(?:actually|fyi|note that)\s*[:,]?\s*(.+?)\s+is\s+(?:actually\s+)?(.+)/i) ||
        lower.match(/(?:set|update|fix)\s+(?:your\s+)?(?:opinion|view|stance|position)\s+(?:on|about)\s+(.+?)\s+to\s+(.+)/i) ||
        lower.match(/(?:your|jarvis(?:'s)?)\s+(?:opinion|view|stance|position)\s+(?:on|about)\s+(.+?)\s+(?:should be|is wrong[:,;]?\s*it's)\s+(.+)/i) ||
        lower.match(/i\s+disagree\s+about\s+(.+?)\s*[—,:-]\s*(.+)/i);
      if (opinionMatch && opinionMatch[1] && opinionMatch[2]) {
        const topic = opinionMatch[1].trim().slice(0, 200);
        const position = opinionMatch[2].trim().slice(0, 600);
        if (topic.length >= 2 && position.length >= 2) {
          try {
            const { setUserOverride } = await import("./opinions.js");
            const opinion = setUserOverride({
              topic,
              position,
              reasoning: "User-stated view via chat",
              confidence: 1.0,
            });
            const response =
              `Got it. I've locked your view on **${opinion.topic}** as authoritative.\n\n` +
              `**Position:** ${opinion.position}\n\n` +
              `I won't auto-overwrite this from retrieval. To unlock or change it, just tell me again.`;
            const assistantMsg = await addMessage({
              conversationId: input.conversationId,
              role: "assistant",
              content: response,
            });
            return { message: assistantMsg, ragChunksUsed: 0 };
          } catch (err) {
            // Fall through to normal RAG handling on failure
            console.warn("[opinion intent] failed:", String(err).slice(0, 200));
          }
        }
      }

      // ── Intent: Calendar Event Creation ───────────────────────────────
      // Catches calendar-specific phrasing BEFORE the generic reminder
      // matcher below, so "add a meeting to my calendar" goes to Google
      // Calendar, not the local reminder scheduler.
      const calendarMatch = lower.match(
        /(?:add|put|schedule|create|book|block\s+off?|block\s+out)\s+(?:an?\s+|some\s+|the\s+)?(?:meeting|appointment|event|focus(?:\s+block)?|call|interview|reservation|time)\b.*?(?:on|to|in|for|with)\s+(?:my\s+)?(?:calendar|cal\b|google\s+calendar)/i
      ) || lower.match(
        /(?:create|add|new)\s+(?:an?\s+|a\s+new\s+)?calendar\s+event/i
      ) || lower.match(
        /(?:add|put|schedule)\s+(?:to|on)\s+(?:my\s+)?(?:calendar|cal\b)/i
      );
      if (calendarMatch) {
        try {
          const cal = await import("./googleCalendar.js");
          if (!cal.getConnectionStatus().connected) {
            const errorMsg =
              `I'd add that to your calendar, but Google Calendar isn't connected yet. ` +
              `Visit http://localhost:3000/api/oauth/google to connect, then try again.`;
            const assistantMsg = await addMessage({
              conversationId: input.conversationId,
              role: "assistant",
              content: errorMsg,
            });
            return { message: assistantMsg, ragChunksUsed: 0 };
          }
          // LLM-parse the natural-language request into structured fields.
          const nowIso = new Date().toISOString();
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
          const parsePrompt =
            `Parse this calendar request into structured fields. Today (${tz}) is ${nowIso}. ` +
            `If the user says "tomorrow at 3pm" resolve it to a real ISO timestamp in their timezone. ` +
            `Default duration: 30 minutes if not specified, 60 minutes for "meeting" / "call", all-day if "all day".\n\n` +
            `Request: "${input.content}"\n\n` +
            `Return STRICT JSON only — no prose:\n` +
            `{"title": "...", "startAt": "ISO 8601", "endAt": "ISO 8601", "location": "..." | null, "description": "..." | null}`;
          const { ollamaChatJson } = await import("./ollama.js");
          const raw = await ollamaChatJson([{ role: "user", content: parsePrompt }]);
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            const errorMsg = `I couldn't parse the calendar event details. Try: "add a meeting with Emma tomorrow at 3pm to my calendar".`;
            const assistantMsg = await addMessage({
              conversationId: input.conversationId,
              role: "assistant",
              content: errorMsg,
            });
            return { message: assistantMsg, ragChunksUsed: 0 };
          }
          const parsed = JSON.parse(jsonMatch[0]);
          if (!parsed?.title || !parsed?.startAt || !parsed?.endAt) {
            const errorMsg = `I caught that you want to schedule something, but I'm missing key details. Try restating with the title, date, and time.`;
            const assistantMsg = await addMessage({
              conversationId: input.conversationId,
              role: "assistant",
              content: errorMsg,
            });
            return { message: assistantMsg, ragChunksUsed: 0 };
          }
          const event = await cal.createEvent({
            title: String(parsed.title),
            startAt: String(parsed.startAt),
            endAt: String(parsed.endAt),
            location: parsed.location ? String(parsed.location) : undefined,
            description: parsed.description ? String(parsed.description) : undefined,
          });
          if (!event) {
            const errorMsg = `Calendar API call failed. Check the server logs and that your token hasn't been revoked.`;
            const assistantMsg = await addMessage({
              conversationId: input.conversationId,
              role: "assistant",
              content: errorMsg,
            });
            return { message: assistantMsg, ragChunksUsed: 0 };
          }
          const startStr = new Date(event.startAt).toLocaleString();
          const endStr = new Date(event.endAt).toLocaleString();
          const where = event.location ? `\n**Where:** ${event.location}` : "";
          const response =
            `Added to your calendar.\n\n**${event.title}**\n**When:** ${startStr} – ${endStr}${where}`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) {
            await updateConversationTitle(
              input.conversationId,
              `Calendar: ${event.title.slice(0, 50)}`
            );
          }
          try {
            reflectOnAction(
              "calendarCreate",
              { title: event.title, startAt: event.startAt },
              `success: created calendar event ${event.id}`
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const errorMsg = `I tried to add that to your calendar but it failed: ${String(err)}`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: errorMsg,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: Scheduled Task / Reminder ────────────────────────────
      // Detect "remind me ...", "schedule ...", "every [day/hour/minute]..."
      const scheduleMatch = lower.match(
        /(?:remind\s+me\s+(?:to|at|in|about)|schedule\s+(?:a\s+)?|set\s+(?:a\s+)?(?:reminder|alarm|timer)\s+(?:to|for|at|in))\s+(.+)/i
      ) || lower.match(
        /^every\s+(?:day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|\d+\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?))\s+(.+)/i
      );
      if (scheduleMatch) {
        const rawText = input.content;
        try {
          const parsed = parseNaturalTime(rawText);
          const taskName = scheduleMatch[1]?.slice(0, 200) || rawText.slice(0, 200);

          if (parsed) {
            const task = createTask({
              name: taskName,
              type: parsed.type,
              cronExpression: parsed.cronExpression ?? null,
              timestamp: parsed.timestamp ?? null,
              intervalMs: parsed.intervalMs ?? null,
              action: "notify",
              payload: taskName,
            });

            const timeDesc = task.nextRun
              ? new Date(task.nextRun).toLocaleString()
              : "unknown";
            const response = `Got it! I've set a ${task.type === "reminder" ? "reminder" : task.type === "recurring" ? "recurring task" : "repeating task"} for you.\n\n**Task:** ${task.name}\n**Type:** ${task.type}\n**Next run:** ${timeDesc}\n**ID:** ${task.id}`;

            const assistantMsg = await addMessage({
              conversationId: input.conversationId,
              role: "assistant",
              content: response,
            });

            const msgs = await getMessages(input.conversationId);
            if (msgs.length === 2) {
              await updateConversationTitle(input.conversationId, `Reminder: ${taskName.slice(0, 50)}`);
            }

            return { message: assistantMsg, ragChunksUsed: 0 };
          }
          // Couldn't parse the time — fall through to RAG
        } catch (err) {
          const errorMsg = `I tried to create that reminder but it failed: ${String(err)}`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: errorMsg,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: CSV / Spreadsheet Analysis ──────────────────────────
      const csvMatch = lower.match(
        /(?:analyze|summarize|parse|examine|inspect|look at|open)\s+(?:this\s+|the\s+|my\s+)?(?:csv|tsv|spreadsheet|data\s*(?:set|file)?|table)/i
      );
      if (csvMatch) {
        const response = `I can analyze CSV and spreadsheet data for you! Please paste your CSV/TSV data or upload a file, and I'll provide:\n\n- **Column types** and statistics\n- **Summary** (min, max, mean, median for numeric columns)\n- **Unique value counts** for text columns\n- **Filtering and grouping** capabilities\n\nYou can use the CSV Analysis panel or paste the data here.`;
        const assistantMsg = await addMessage({
          conversationId: input.conversationId,
          role: "assistant",
          content: response,
        });
        const msgs = await getMessages(input.conversationId);
        if (msgs.length === 2) {
          await updateConversationTitle(input.conversationId, `CSV Analysis`);
        }
        return { message: assistantMsg, ragChunksUsed: 0 };
      }

      // ── Intent: Video Editing ─────────────────────────────────────────
      const videoEditMatch = lower.match(
        /(?:trim|cut|crop|merge|combine|concatenate|join)\s+(?:this\s+|the\s+|my\s+)?(?:video|clip|mp4|mov|avi|mkv)/i
      ) || lower.match(
        /(?:add\s+subtitles?\s+to|subtitle|extract\s+audio\s+from|get\s+(?:the\s+)?audio\s+from|rip\s+audio)/i
      );
      if (videoEditMatch) {
        const response = `I can help with video editing! Here's what I can do:\n\n- **Trim/Cut** a video to a specific time range\n- **Merge** multiple videos together\n- **Add subtitles** (burn-in from text or SRT file)\n- **Extract audio** from a video\n- **Get video info** (duration, resolution, codec)\n- **Generate thumbnails** at specific timestamps\n\nPlease provide the file path and what you'd like to do. For example:\n- "Trim my video at C:/Videos/clip.mp4 from 00:01:00 to 00:02:30"\n- "Extract audio from C:/Videos/lecture.mp4"`;
        const assistantMsg = await addMessage({
          conversationId: input.conversationId,
          role: "assistant",
          content: response,
        });
        const msgs = await getMessages(input.conversationId);
        if (msgs.length === 2) {
          await updateConversationTitle(input.conversationId, `Video Editing`);
        }
        return { message: assistantMsg, ragChunksUsed: 0 };
      }

      // ── Intent: Weather ──────────────────────────────────────────────
      const weatherMatch = lower.match(
        /(?:what(?:'s| is) the )?weather\s+(?:in|for|at)\s+(.+?)(?:\?|$)/i
      ) || lower.match(
        /(?:how(?:'s| is) (?:the )?weather\s+(?:in|for|at)\s+)(.+?)(?:\?|$)/i
      );
      if (weatherMatch) {
        const city = weatherMatch[1].trim();
        try {
          const w = await getWeather(city);
          const response = `**Weather in ${w.location}**\n\n- **Temperature:** ${w.temperature}\n- **Feels Like:** ${w.feelsLike}\n- **Condition:** ${w.condition}\n- **Humidity:** ${w.humidity}\n- **Wind:** ${w.wind}`;
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: response });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) await updateConversationTitle(input.conversationId, `Weather: ${city.slice(0, 50)}`);
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: `Couldn't get weather for "${city}": ${String(err)}` });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: Crypto Price ────────────────────────────────────────────
      const cryptoMatch = lower.match(
        /(?:(?:what(?:'s| is) (?:the )?)?(?:price|value|cost)\s+(?:of\s+)?|how much is\s+)(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|cardano|ada|xrp|ripple|litecoin|ltc|polkadot|dot|[\w-]+)\s*(?:price)?(?:\?|$)/i
      ) || lower.match(
        /^(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|xrp|ripple)\s*(?:price)?(?:\?|$)/i
      );
      if (cryptoMatch) {
        const coinMap: Record<string, string> = {
          btc: "bitcoin", eth: "ethereum", sol: "solana", doge: "dogecoin",
          ada: "cardano", xrp: "ripple", ltc: "litecoin", dot: "polkadot",
        };
        const rawCoin = cryptoMatch[1].trim().toLowerCase();
        const coin = coinMap[rawCoin] || rawCoin;
        try {
          const p = await getCryptoPrice(coin);
          const change = p.change24h !== null ? `${p.change24h > 0 ? "+" : ""}${p.change24h.toFixed(2)}%` : "N/A";
          const mcap = p.marketCap !== null ? `$${(p.marketCap / 1e9).toFixed(2)}B` : "N/A";
          const response = `**${coin.charAt(0).toUpperCase() + coin.slice(1)} Price**\n\n- **Price:** $${p.priceUSD.toLocaleString()}\n- **24h Change:** ${change}\n- **Market Cap:** ${mcap}`;
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: response });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) await updateConversationTitle(input.conversationId, `${coin} price`);
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: `Couldn't get price for "${coin}": ${String(err)}` });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: Define Word ──────────────────────────────────────────────
      const defineMatch = lower.match(
        /(?:define|what does|what(?:'s| is) the (?:definition|meaning) of)\s+["""]?([\w-]+)["""]?(?:\s+mean)?(?:\?|$)/i
      );
      if (defineMatch) {
        const word = defineMatch[1].trim();
        try {
          const d = await defineWord(word);
          let response = `**${d.word}** ${d.phonetic ? `(${d.phonetic})` : ""}\n`;
          for (const m of d.meanings) {
            response += `\n*${m.partOfSpeech}*\n`;
            for (const def of m.definitions) {
              response += `- ${def.definition}`;
              if (def.example) response += ` _(e.g., "${def.example}")_`;
              response += "\n";
            }
          }
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: response });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) await updateConversationTitle(input.conversationId, `Define: ${word}`);
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: `Couldn't define "${word}": ${String(err)}` });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: Exchange Rate ────────────────────────────────────────────
      const exchangeMatch = lower.match(
        /(?:exchange\s+rate|convert|how much is)\s+(?:\d+\s+)?([a-z]{3})\s+(?:to|in|into)\s+([a-z]{3})/i
      ) || lower.match(
        /([a-z]{3})\s+to\s+([a-z]{3})\s+(?:rate|exchange|conversion)/i
      );
      if (exchangeMatch) {
        const from = exchangeMatch[1].toUpperCase();
        const to = exchangeMatch[2].toUpperCase();
        try {
          const r = await getExchangeRate(from, to);
          const response = `**Exchange Rate**\n\n1 ${r.from} = **${r.rate.toFixed(4)} ${r.to}**\n\n_Last updated: ${r.timestamp}_`;
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: response });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) await updateConversationTitle(input.conversationId, `${from} to ${to}`);
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: `Couldn't get exchange rate: ${String(err)}` });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: Stock Market Analysis ────────────────────────────────
      // Detect "analyze [TICKER]", "stock price of [X]", "how is [TICKER] doing"
      const stockAnalyzeMatch = lower.match(
        /(?:analyze|analysis\s+of|research|deep\s+dive)\s+(?:stock\s+)?(?:ticker\s+)?([A-Z]{1,5})\b/i
      ) || lower.match(
        /(?:stock|market)\s+(?:analysis|report|brief)\s+(?:for|on|of)\s+([A-Z]{1,5})\b/i
      );
      const stockPriceMatch = !stockAnalyzeMatch ? lower.match(
        /(?:stock\s+price|price\s+of|how\s+is|how's|check)\s+(?:stock\s+)?(?:ticker\s+)?([A-Z]{1,5})\b/i
      ) || lower.match(
        /\b([A-Z]{2,5})\s+(?:stock|share)\s+price/i
      ) : null;
      const watchlistMatch = !stockAnalyzeMatch && !stockPriceMatch ? lower.match(
        /(?:add|watch|track)\s+([A-Z]{1,5})\s+(?:to\s+)?(?:watchlist|watch\s+list)/i
      ) || lower.match(
        /(?:watchlist|watch\s+list)\s+(?:add|track)\s+([A-Z]{1,5})/i
      ) : null;

      if (stockAnalyzeMatch) {
        const sym = stockAnalyzeMatch[1].toUpperCase();
        try {
          const analysis = await analyzeStock(sym);
          let response = `## Stock Analysis: ${analysis.overview?.name || sym} (${sym})\n\n`;
          if (analysis.quote) {
            response += `**Price:** $${analysis.quote.price} (${analysis.quote.changePercent} today)\n`;
            response += `**Volume:** ${analysis.quote.volume.toLocaleString()}\n\n`;
          }
          if (analysis.overview) {
            response += `**Sector:** ${analysis.overview.sector} | **Industry:** ${analysis.overview.industry}\n`;
            response += `**Market Cap:** $${Number(analysis.overview.marketCap).toLocaleString()} | **P/E:** ${analysis.overview.peRatio} | **EPS:** $${analysis.overview.eps}\n`;
            response += `**52-Week:** $${analysis.overview.weekLow52} - $${analysis.overview.weekHigh52} | **Analyst Target:** $${analysis.overview.analystTarget}\n\n`;
          }
          if (analysis.knowledgeConnections.length > 0) {
            response += `### Knowledge Graph Connections\n`;
            for (const c of analysis.knowledgeConnections.slice(0, 5)) {
              response += `- **${c.entity}** (${c.type}): ${c.relevance}\n`;
            }
            response += `\n`;
          }
          if (analysis.news.length > 0) {
            response += `### Recent News\n`;
            for (const n of analysis.news.slice(0, 5)) {
              response += `- [${n.sentiment}] ${n.title}\n`;
            }
            response += `\n`;
          }
          response += `### AI Analysis\n${analysis.aiSummary}`;

          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) await updateConversationTitle(input.conversationId, `Stock: ${sym}`);

          // Fire-and-forget reflection on the stock analysis
          try {
            reflectOnAction(
              "analyzeStock",
              { symbol: sym },
              `analyzed ${sym}: price=${analysis.quote?.price ?? "n/a"}, news=${analysis.news?.length ?? 0} items, kgConnections=${analysis.knowledgeConnections?.length ?? 0}`
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}

          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: `Stock analysis for ${sym} failed: ${err}`,
          });
          try {
            reflectOnAction(
              "analyzeStock",
              { symbol: sym },
              `failure: ${String(err)}`
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      if (stockPriceMatch) {
        const sym = stockPriceMatch[1].toUpperCase();
        try {
          const quote = await getQuote(sym);
          const response = `**${sym}** — $${quote.price} (${quote.changePercent} today)\nOpen: $${quote.open} | High: $${quote.high} | Low: $${quote.low} | Volume: ${quote.volume.toLocaleString()}`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: `Couldn't get quote for ${sym}: ${err}`,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      if (watchlistMatch) {
        const sym = watchlistMatch[1].toUpperCase();
        try {
          addToWatchlist({ symbol: sym });
          const response = `Added **${sym}** to your watchlist. You can set price alerts or ask me to check your watchlist anytime.`;
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: `Failed to add ${sym} to watchlist: ${err}`,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: Trading ─────────────────────────────────────────────
      const buyMatch = lower.match(/\bbuy\s+(\d+)\s+(?:shares?\s+(?:of\s+)?)?([A-Z]{1,5})\b/i);
      const sellMatch = !buyMatch ? lower.match(/\bsell\s+(\d+)\s+(?:shares?\s+(?:of\s+)?)?([A-Z]{1,5})\b/i) : null;
      const tradeRecMatch = !buyMatch && !sellMatch ? lower.match(/(?:should\s+i\s+(?:buy|sell|trade)|trade\s+recommendation\s+(?:for|on)|recommend.*(?:buy|sell))\s+([A-Z]{1,5})\b/i) : null;
      const tradeModeMatch = !buyMatch && !sellMatch && !tradeRecMatch ? lower.match(/(?:set|switch|change|toggle)\s+(?:trading|trade)\s+(?:mode\s+)?(?:to\s+)?(off|paper|approval|auto)/i) : null;
      const portfolioMatch = !buyMatch && !sellMatch && !tradeRecMatch && !tradeModeMatch ? lower.match(/\b(?:my\s+)?(?:portfolio|positions|holdings|account\s+balance|buying\s+power)\b/i) : null;

      if (buyMatch || sellMatch) {
        const match = buyMatch || sellMatch;
        const side = buyMatch ? "buy" : "sell";
        const qty = parseInt(match![1]);
        const sym = match![2].toUpperCase();
        try {
          const result = await placeTrade({ symbol: sym, side: side as any, qty, reason: `Chat: ${input.content}` });
          let response: string;
          if (result.error) {
            response = `Trade blocked: ${result.error}`;
          } else if (result.pendingId) {
            response = `Trade **pending approval**: ${side} ${qty} shares of ${sym}\n\nPending ID: \`${result.pendingId}\`\nSay "approve trade" or manage in the trading panel.`;
          } else {
            response = `Order placed: **${side} ${qty} ${sym}** — Status: ${result.order?.status}`;
          }
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: response });

          // Fire-and-forget reflection on the trade
          try {
            const tradeOutcome = result.error
              ? `blocked: ${result.error}`
              : result.pendingId
              ? `pending approval (${result.pendingId})`
              : `placed: status=${result.order?.status}`;
            reflectOnAction(
              "placeTrade",
              { symbol: sym, side, qty },
              tradeOutcome
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}

          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: `Trade failed: ${err}` });
          try {
            reflectOnAction(
              "placeTrade",
              { symbol: sym, side, qty },
              `failure: ${String(err)}`
            ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
          } catch {}
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      if (tradeRecMatch) {
        const sym = tradeRecMatch[1].toUpperCase();
        try {
          const rec = await getTradeRecommendation(sym);
          const response = `## Trade Recommendation: ${sym}\n\n**Action:** ${rec.action.toUpperCase()}\n**Confidence:** ${(rec.confidence * 100).toFixed(0)}%\n**Reason:** ${rec.reason}${rec.suggestedQty ? `\n**Suggested Qty:** ${rec.suggestedQty}` : ""}${rec.suggestedPrice ? `\n**Suggested Price:** $${rec.suggestedPrice}` : ""}`;
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: response });
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: `Recommendation failed: ${err}` });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      if (tradeModeMatch) {
        const mode = tradeModeMatch[1].toLowerCase() as TradingMode;
        setTradingMode(mode);
        const descriptions: Record<string, string> = {
          off: "Trading disabled. Analysis only.",
          paper: "Paper trading — fake money, real market data.",
          approval: "Live trading — every order requires your approval.",
          auto: "Autonomous trading within safety limits.",
        };
        const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: `Trading mode set to **${mode.toUpperCase()}**.\n\n${descriptions[mode]}` });
        return { message: assistantMsg, ragChunksUsed: 0 };
      }

      if (portfolioMatch) {
        try {
          const [account, positions] = await Promise.all([getAccount(), getPositions()]);
          let response = `## Portfolio Overview\n\n**Cash:** $${account.cash.toLocaleString()}\n**Portfolio Value:** $${account.portfolioValue.toLocaleString()}\n**Buying Power:** $${account.buyingPower.toLocaleString()}\n**Equity:** $${account.equity.toLocaleString()}\n\n`;
          if (positions.length > 0) {
            response += `### Positions\n| Symbol | Qty | Avg Entry | Current | P/L | P/L % |\n|--------|-----|-----------|---------|-----|-------|\n`;
            for (const p of positions) {
              const plColor = p.unrealizedPL >= 0 ? "+" : "";
              response += `| ${p.symbol} | ${p.qty} | $${p.avgEntryPrice.toFixed(2)} | $${p.currentPrice.toFixed(2)} | ${plColor}$${p.unrealizedPL.toFixed(2)} | ${plColor}${p.unrealizedPLPercent.toFixed(1)}% |\n`;
            }
          } else {
            response += "No open positions.";
          }
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: response });
          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          const assistantMsg = await addMessage({ conversationId: input.conversationId, role: "assistant", content: `Portfolio check failed: ${err}` });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }
      }

      // ── Intent: Goal Persistence ──────────────────────────────────────
      // Long-term goal language → persist it, decompose, and report back.
      // Also handles "list my goals" / "what are my goals" / "show goals"
      // and "I finished X" / "mark X complete" against an existing goal.
      try {
        const listGoalsMatch = lower.match(/\b(?:list|show|display|view|what\s+are)\s+(?:all\s+)?(?:my|the)?\s*goals?\b/i);
        const completeGoalMatch = !listGoalsMatch
          ? input.content.match(/\b(?:i\s+(?:just\s+)?finished|i\s+(?:just\s+)?completed|mark(?:\s+goal)?(?:\s+(?:#|number\s*))?\s*(\d+)?\s*as\s+(?:complete|done|finished))\b\s*(.*)/i)
          : null;
        const newGoalMatch = !listGoalsMatch && !completeGoalMatch
          ? input.content.match(/\b(?:my\s+(?:long-term\s+|new\s+)?goal\s+is\s+to|i\s+want\s+to(?:\s+(?:eventually|finally))?|help\s+me\s+(?:to\s+|with\s+)?|i'?m\s+(?:planning|trying)\s+to|i\s+need\s+to\s+(?:eventually|finally))\s+(.{8,})/i)
          : null;

        if (listGoalsMatch) {
          const all = listGoals("active");
          let response: string;
          if (all.length === 0) {
            response = "You don't have any active goals tracked yet. Tell me \"my goal is to ...\" and I'll start tracking it.";
          } else {
            const lines = ["## Your Active Goals", ""];
            for (const g of all) {
              const dl = g.deadline ? ` — deadline ${new Date(g.deadline).toISOString().slice(0, 10)}` : "";
              lines.push(`### Goal #${g.id}: ${g.title} (${g.progress}%)${dl}`);
              if (g.description) lines.push(`*${g.description}*`);
              const open = g.subtasks.filter((s) => s.status !== "complete").slice(0, 5);
              for (const s of open) {
                const tag = s.status === "in_progress" ? "[in progress]"
                  : s.status === "blocked" ? "[blocked]"
                  : "[ ]";
                lines.push(`- ${tag} ${s.title}`);
              }
              lines.push("");
            }
            response = lines.join("\n");
          }
          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });
          return { message: assistantMsg, ragChunksUsed: 0 };
        }

        if (newGoalMatch) {
          const rawGoal = newGoalMatch[1].trim().replace(/[.!?]+$/, "");
          // Try to extract a deadline from "by September", "by 2026-09-01", etc.
          let deadline: number | null = null;
          const byMatch = rawGoal.match(/\bby\s+([A-Za-z0-9\-\s,]+?)(?:[.,]|$)/i);
          if (byMatch) {
            const parsed = Date.parse(byMatch[1].trim());
            if (Number.isFinite(parsed)) deadline = parsed;
          }

          const created = await createGoal({
            title: rawGoal.slice(0, 200),
            description: `Captured from chat on ${new Date().toISOString().slice(0, 10)}: "${input.content.slice(0, 500)}"`,
            deadline,
          });

          const lines = [
            `Tracking new goal **#${created.id}: ${created.title}**.`,
            deadline ? `Deadline noted: ${new Date(deadline).toISOString().slice(0, 10)}.` : "",
            "",
            created.subtasks.length > 0 ? "I broke it into these starter subtasks:" : "I'll keep this in mind across future conversations.",
          ].filter(Boolean);
          for (const s of created.subtasks) {
            lines.push(`- [ ] ${s.title}${s.description ? ` — ${s.description}` : ""}`);
          }
          lines.push("", "Say \"list my goals\" anytime to review, or \"I finished X\" to close out a subtask.");

          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: lines.join("\n"),
          });
          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) {
            await updateConversationTitle(input.conversationId, `Goal: ${created.title.slice(0, 50)}`);
          }
          return { message: assistantMsg, ragChunksUsed: 0 };
        }

        if (completeGoalMatch) {
          // Try to find the matching goal/subtask. If a goal id is given, use it;
          // otherwise fuzzy-match the rest of the message against subtask titles.
          const explicitId = completeGoalMatch[1] ? Number(completeGoalMatch[1]) : null;
          const remainder = (completeGoalMatch[2] || "").trim().toLowerCase();
          const candidates = listGoals("active");
          let matchedGoalId: number | null = null;
          let matchedSubtaskId: number | null = null;

          if (explicitId) {
            const g = candidates.find((c) => c.id === explicitId);
            if (g) matchedGoalId = g.id;
          }

          if (!matchedSubtaskId && remainder.length >= 3) {
            for (const g of candidates) {
              for (const s of g.subtasks) {
                if (s.status === "complete") continue;
                const t = s.title.toLowerCase();
                if (t.includes(remainder) || remainder.includes(t)) {
                  matchedGoalId = g.id;
                  matchedSubtaskId = s.id;
                  break;
                }
              }
              if (matchedSubtaskId) break;
            }
          }

          let response = "";
          if (matchedGoalId && matchedSubtaskId) {
            await updateSubtaskStatus(matchedGoalId, matchedSubtaskId, "complete");
            const refreshed = getGoal(matchedGoalId);
            response = `Marked subtask complete on goal #${matchedGoalId}. Progress now ${refreshed?.progress ?? 0}%.`;
          } else if (matchedGoalId) {
            await updateGoalStatus(matchedGoalId, "completed");
            response = `Marked goal #${matchedGoalId} as completed. Nice work.`;
          }

          if (response) {
            const assistantMsg = await addMessage({
              conversationId: input.conversationId,
              role: "assistant",
              content: response,
            });
            return { message: assistantMsg, ragChunksUsed: 0 };
          }
          // No match → fall through to the normal RAG path so chat continues.
        }
      } catch (err) {
        await logger.warn("goals", `Goal intent handler failed, falling through to default: ${String(err)}`);
      }

      // ── Intent: Multi-step workflow / Planner ─────────────────────────
      // Detect complex multi-step requests (e.g. "analyze X and then notify me").
      // Route those to the tool-composition planner rather than single-shot RAG.
      if (looksLikeMultiStepRequest(input.content)) {
        try {
          const trace = await planAndExecute(input.content);
          const planSection = trace.plan.length > 0
            ? trace.plan
                .map((s) => `${s.step}. \`${s.tool}\`${s.condition ? ` (if ${s.condition})` : ""} → \`${s.outputName}\``)
                .join("\n")
            : "(planner returned no steps)";

          const response = [
            "## Planner",
            "",
            "### Generated plan",
            planSection,
            "",
            trace.summary,
          ].join("\n");

          const assistantMsg = await addMessage({
            conversationId: input.conversationId,
            role: "assistant",
            content: response,
          });

          const msgs = await getMessages(input.conversationId);
          if (msgs.length === 2) {
            await updateConversationTitle(
              input.conversationId,
              `Plan: ${input.content.slice(0, 50)}`
            );
          }

          return { message: assistantMsg, ragChunksUsed: 0 };
        } catch (err) {
          // Fall through to RAG on planner failure — never break the chat.
          await logger.warn("planner", `Planner path failed, falling back to RAG: ${err}`);
        }
      }

      // ── Default: RAG-augmented response ───────────────────────────────
      // Get conversation history for context
      const allMessages = await getMessages(input.conversationId);
      const history = allMessages
        .slice(-20)
        .filter((m: any) => m.role !== "system")
        .map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content }));

      // Meta-cognition: threshold-aware RAG. If the first pass scores below
      // the user's confidence threshold and didn't use the reasoning model,
      // ragChat retries via reasoning (same retrieval, different model).
      const meta = getMetaSettings();
      const { response, thinking, ragChunks, usedReasoning, retriedForConfidence } =
        await ragChat(
          input.content,
          history.slice(0, -1), // exclude the message we just added
          input.model,
          input.forceReasoning,
          { retryBelowConfidence: meta.confidenceThreshold }
        );

      // Gate decides ship vs refuse. Below-threshold → refuse with an honest
      // status message and queue targeted research in the background so the
      // user can re-ask later with more grounded knowledge available.
      const { finalResponse, confidence } = await applyConfidenceGate({
        query: input.content,
        response,
        ragChunks,
        conversationId: input.conversationId,
      });

      // Save assistant message — parentId links to the user message we just
      // added, enabling branch navigation if the user edits/retries later.
      const assistantMsg = await addMessage({
        conversationId: input.conversationId,
        role: "assistant",
        content: finalResponse,
        parentId: (input as any)._userMessageId ?? null,
        isActive: 1,
        modelUsed: input.model || (usedReasoning ? "reasoning" : "default"),
        ragChunksUsed: ragChunks.map((c) => ({
          id: c.id,
          source: c.metadata.sourceTitle || c.metadata.sourceUrl || "Unknown",
          url: c.metadata.sourceUrl || null,
          title: c.metadata.sourceTitle || null,
          sourceType: c.metadata.sourceType || null,
          distance: c.distance,
        })),
      });

      // Detect confusion in response (hedge words like "I think", "maybe",
      // "not sure"). When 2+ are present we log a confusion_event so the
      // weakness aggregator can surface weak topics over time. Fire-and-forget.
      try {
        const hedgeFound = detectHedgeWords(response);
        if (hedgeFound.length >= 2) {
          recordConfusion(
            input.conversationId,
            assistantMsg.id,
            response,
            hedgeFound.join(",")
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        }
      } catch {
        /* never let hedge detection break chat */
      }

      // Process memory in background
      processConversationMemory(input.conversationId).catch(err =>
        logger.error("memory", `Background memory processing failed: ${err}`)
      );

      // Auto-title conversation after first exchange
      const msgs = await getMessages(input.conversationId);
      if (msgs.length === 2) {
        const title = input.content.slice(0, 60) + (input.content.length > 60 ? "..." : "");
        await updateConversationTitle(input.conversationId, title);
      }

      return {
        message: assistantMsg,
        ragChunksUsed: ragChunks.length,
        thinking,
        usedReasoning,
        confidence: {
          score: confidence.score,
          action: confidence.action,
          threshold: confidence.threshold,
          intent: confidence.intent,
          reasons: confidence.reasons,
          signals: confidence.signals,
          topic: confidence.topic,
          retriedForConfidence: retriedForConfidence ?? false,
        },
      };
    }),

  deleteConversation: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteConversation(input.id);
      return { success: true };
    }),

  transcribeAudio: publicProcedure
    .input(z.object({ audioUrl: z.string().url() }))
    .mutation(async ({ input }) => {
      const result = await transcribeAudio({ audioUrl: input.audioUrl, language: "en" });
      const text = 'text' in result ? result.text : '';
      return { text };
    }),

  // ── Inline Image Analysis ──────────────────────────────────────────────
  analyzeImage: publicProcedure
    .input(
      z.object({
        conversationId: z.number(),
        imageBase64: z.string().min(1),
        mimeType: z.string().default("image/png"),
        filename: z.string().default("image.png"),
        question: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const question = input.question?.trim() || "Describe this image in detail.";

      // Save user message
      await addMessage({
        conversationId: input.conversationId,
        role: "user",
        content: `[Image attached: ${input.filename}] ${question}`,
      });

      try {
        // Try Ollama vision model (llava)
        const visionPrompt = question;
        const response = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llava",
            prompt: visionPrompt,
            images: [input.imageBase64],
            stream: false,
          }),
        });

        let analysis: string;
        if (response.ok) {
          const data = await response.json();
          analysis = data.response || "No analysis returned from vision model.";
        } else {
          // Fallback: describe that we can't process images without a vision model
          analysis =
            "I received your image but I don't have a vision model (like LLaVA) available right now to analyze it. " +
            "Please install a vision model in Ollama (`ollama pull llava`) and try again.";
        }

        const assistantMsg = await addMessage({
          conversationId: input.conversationId,
          role: "assistant",
          content: analysis,
        });

        // Auto-title
        const msgs = await getMessages(input.conversationId);
        if (msgs.length === 2) {
          const title = `Image: ${question.slice(0, 50)}`;
          await updateConversationTitle(input.conversationId, title);
        }

        return { message: assistantMsg, ragChunksUsed: 0 };
      } catch (err) {
        const errorMsg = `Failed to analyze image: ${String(err)}. Make sure Ollama is running with a vision model (llava).`;
        const assistantMsg = await addMessage({
          conversationId: input.conversationId,
          role: "assistant",
          content: errorMsg,
        });
        return { message: assistantMsg, ragChunksUsed: 0 };
      }
    }),

  // ── Folder Management ──────────────────────────────────────────────────
  listFolders: publicProcedure.query(() => getFolders()),

  createFolder: publicProcedure
    .input(z.object({ name: z.string().min(1).max(100), color: z.string().optional() }))
    .mutation(({ input }) => {
      const id = createFolder(input.name, input.color);
      return { id, name: input.name, color: input.color ?? "#3b82f6" };
    }),

  updateFolder: publicProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      color: z.string().optional(),
    }))
    .mutation(({ input }) => {
      updateFolder(input.id, input);
      return { success: true };
    }),

  deleteFolder: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => {
      deleteFolder(input.id);
      return { success: true };
    }),

  moveToFolder: publicProcedure
    .input(z.object({
      conversationId: z.number(),
      folderId: z.number().nullable(),
    }))
    .mutation(({ input }) => {
      moveConversationToFolder(input.conversationId, input.folderId);
      return { success: true };
    }),

  // ── Edit a message in place (user or assistant) ──────────────────────────
  editMessage: publicProcedure
    .input(z.object({
      messageId: z.number(),
      newContent: z.string().min(1).max(16000),
    }))
    .mutation(async ({ input }) => {
      await updateMessageContent(input.messageId, input.newContent);
      return { success: true };
    }),

  // ── Delete a single message ──────────────────────────────────────────────
  deleteMessage: publicProcedure
    .input(z.object({ messageId: z.number() }))
    .mutation(async ({ input }) => {
      await deleteMessageById(input.messageId);
      return { success: true };
    }),

  // ── Retry / Edit+Retry: BRANCHING version
  // Instead of deleting, preserves the old chain as an inactive branch so the
  // user can switch back later. Behavior:
  //   - Pure retry (no editedContent): deactivates the assistant reply that
  //     followed this user message (and its descendants). Next sendMessage
  //     will create a new sibling under the same user message.
  //   - Edit+retry: creates a NEW user message as a sibling of the original
  //     (both share the same parentId). Original user message + its subtree
  //     get deactivated. New user message becomes active and will receive
  //     the fresh assistant response.
  retryFromMessage: publicProcedure
    .input(z.object({
      messageId: z.number(),          // the USER message to retry from
      editedContent: z.string().optional(), // optional — edit + retry
    }))
    .mutation(async ({ input }) => {
      const msg = await getMessageById(input.messageId);
      if (!msg) throw new TRPCError({ code: "NOT_FOUND" });

      // Case 1: edit + retry → create new user sibling under same parent
      if (input.editedContent !== undefined && input.editedContent !== msg.content) {
        // Deactivate the original user message and its entire subtree
        deactivateSubtree(input.messageId);
        // Add the edited user message as a sibling (same parentId)
        const newUserMsg = await addMessage({
          conversationId: msg.conversationId,
          role: "user",
          content: input.editedContent,
          parentId: (msg as any).parentId ?? null,
          isActive: 1,
        });
        return {
          success: true,
          conversationId: msg.conversationId,
          userContent: input.editedContent,
          newUserMessageId: newUserMsg.id,
        };
      }

      // Case 2: pure retry → deactivate all children of this user message
      // (the old assistant response and any follow-ups). New assistant
      // response will be created as a new sibling.
      const children = getMessageChildren(input.messageId);
      for (const c of children) {
        deactivateSubtree((c as any).id);
      }
      return {
        success: true,
        conversationId: msg.conversationId,
        userContent: msg.content,
        newUserMessageId: null,
      };
    }),

  // ── Regenerate an assistant reply to an existing user message ────────────
  // Used after retryFromMessage has deactivated the old reply. Creates a
  // fresh assistant sibling under the same user message.
  regenerateReply: publicProcedure
    .input(z.object({
      userMessageId: z.number(),
      model: z.string().optional(),
      forceReasoning: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const userMsg = await getMessageById(input.userMessageId);
      if (!userMsg || (userMsg as any).role !== "user") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not a user message" });
      }
      const convId = (userMsg as any).conversationId;

      // Build history from active messages up to (but not including) children of userMsg
      const allActive = await getMessages(convId);
      const history = allActive
        .filter((m: any) => m.createdAt <= (userMsg as any).createdAt && m.role !== "system")
        .slice(-20)
        .map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const { response, thinking, ragChunks, usedReasoning } = await ragChat(
        (userMsg as any).content,
        history.slice(0, -1),
        input.model,
        input.forceReasoning
      );

      const assistantMsg = await addMessage({
        conversationId: convId,
        role: "assistant",
        content: response,
        parentId: input.userMessageId,
        isActive: 1,
        modelUsed: input.model || (usedReasoning ? "reasoning" : "default"),
        ragChunksUsed: ragChunks.map((c) => ({
          id: c.id,
          source: c.metadata.sourceTitle || c.metadata.sourceUrl || "Unknown",
          url: c.metadata.sourceUrl || null,
          title: c.metadata.sourceTitle || null,
          sourceType: c.metadata.sourceType || null,
          distance: c.distance,
        })),
      });

      // Reflection on the main RAG chat turn — gives the system a per-turn
      // signal it can analyze later for trend detection (low-RAG-chunk turns
      // tend to be confused; reasoning turns tend to be slower; etc.).
      // Audit Tier-2 finding: reflection layer existed but wasn't called from
      // the main chat path. Uses recordReflection (sync, no LLM cost) rather
      // than reflectOnAction (async, LLM-evaluated) — we already have the
      // signal we need without re-asking the model.
      try {
        const { recordReflection } = await import("./reflection.js");
        const confidence =
          ragChunks.length >= 10 ? 0.85 :
          ragChunks.length >= 5 ? 0.7 :
          ragChunks.length >= 1 ? 0.55 : 0.3;
        const lesson = ragChunks.length === 0
          ? `Answered "${(userMsg as any).content.slice(0, 100)}" with zero retrieved chunks — purely model knowledge`
          : `Answered "${(userMsg as any).content.slice(0, 100)}" with ${ragChunks.length} chunks${usedReasoning ? " (reasoning mode)" : ""}`;
        recordReflection(
          "ragChat",
          {
            queryPreview: (userMsg as any).content.slice(0, 200),
            chunkCount: ragChunks.length,
            usedReasoning,
            modelUsed: input.model ?? null,
          },
          ragChunks.length === 0 ? "partial" : "success",
          confidence,
          lesson,
          ["chat", usedReasoning ? "reasoning" : "default", ragChunks.length === 0 ? "no-rag" : "with-rag"]
        );
      } catch { /* never let a reflection bug break a chat reply */ }

      return { message: assistantMsg, thinking, usedReasoning, ragChunksUsed: ragChunks.length };
    }),

  // ── Branch navigation ────────────────────────────────────────────────────
  getBranchInfo: publicProcedure
    .input(z.object({ messageId: z.number() }))
    .query(({ input }) => getBranchInfo(input.messageId)),

  switchBranch: publicProcedure
    .input(z.object({ targetMessageId: z.number() }))
    .mutation(({ input }) => {
      const leafId = switchToBranch(input.targetMessageId);
      return { success: true, leafMessageId: leafId };
    }),

  // Returns ALL messages in the conversation including inactive branches.
  // Used by the UI to show the branch tree view.
  getAllMessages: publicProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input }) => getAllMessages(input.conversationId)),

  // ── Token stats ──────────────────────────────────────────────────────────
  tokenStats: publicProcedure
    .input(z.object({ conversationId: z.number().optional() }).optional())
    .query(({ input }) => getTokenStats({ conversationId: input?.conversationId })),

  // ── Text-to-speech for a message (returns a URL to the MP3) ──────────────
  // Used by the "replay audio" button on each assistant message. Reuses
  // existing cloneTrevorsVoice + generated-audio serving route.
  ttsMessage: publicProcedure
    .input(z.object({
      messageId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const msg = await getMessageById(input.messageId);
      if (!msg) throw new TRPCError({ code: "NOT_FOUND" });
      const clean = String(msg.content || "").replace(/[#*`_~\[\]]/g, "").trim();
      if (!clean) throw new TRPCError({ code: "BAD_REQUEST", message: "Empty message" });
      const filepath = await cloneTrevorsVoice(clean);
      const filename = path.basename(filepath);
      return { audioUrl: `/api/generated-audio/${filename}`, filename };
    }),

  // ── Text-to-speech for arbitrary text ────────────────────────────────────
  ttsText: publicProcedure
    .input(z.object({
      text: z.string().min(1).max(8000),
    }))
    .mutation(async ({ input }) => {
      const clean = input.text.replace(/[#*`_~\[\]]/g, "").trim();
      const filepath = await cloneTrevorsVoice(clean);
      const filename = path.basename(filepath);
      return { audioUrl: `/api/generated-audio/${filename}`, filename };
    }),
});

// ── Knowledge Router ──────────────────────────────────────────────────────────
const knowledgeRouter = router({
  list: publicProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const chunks = await getKnowledgeChunks(input.limit, input.offset);
      const total = await countKnowledgeChunks();
      return { chunks, total };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteKnowledgeChunk(input.id);
      return { success: true };
    }),
});

// ── Scraper Router ────────────────────────────────────────────────────────────
const scraperRouter = router({
  listSources: publicProcedure.query(() => getScrapeSources()),

  addSource: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        url: z.string().url(),
        type: z.enum(["rss", "news", "custom_url"]),
        intervalMinutes: z.number().min(5).max(1440).default(60),
      })
    )
    .mutation(async ({ input }) => {
      return addScrapeSource(input);
    }),

  toggleSource: publicProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      await toggleScrapeSource(input.id, input.isActive);
      return { success: true };
    }),

  deleteSource: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteScrapeSource(input.id);
      return { success: true };
    }),

  scrapeNow: publicProcedure
    .input(
      z.object({
        sourceId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (input.sourceId) {
        const sources = await getScrapeSources();
        const source = sources.find((s: any) => s.id === input.sourceId);
        if (!source) throw new TRPCError({ code: "NOT_FOUND" });
        return scrapeSource({ id: source.id, url: source.url, name: source.name, type: source.type });
      }
      return scrapeAllSources();
    }),

  scrapeURL: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const tempSource = {
        id: -1,
        url: input.url,
        name: input.name || new URL(input.url).hostname,
        type: "custom_url" as const,
      };
      return scrapeSource(tempSource);
    }),

  seedSources: publicProcedure.mutation(async () => {
    return seedDefaultSources();
  }),

  webCrawl: publicProcedure.mutation(async () => {
    return runWebCrawlCycle();
  }),

  discoverSources: publicProcedure.mutation(async () => {
    return runSourceDiscovery();
  }),

  getEnabled: publicProcedure.query(() => ({ enabled: isScraperEnabled() })),

  setEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      setScraperEnabled(input.enabled);
      try {
        await setSetting(
          "scraper_enabled",
          input.enabled ? "true" : "false",
          "boolean",
          null,
          "Global on/off switch for background scraping scheduler"
        );
      } catch (err) {
        await logger.warn("scraper", `Failed to persist scraper_enabled: ${String(err)}`);
      }
      return { enabled: input.enabled };
    }),
});

// ── Media Ingest Router ────────────────────────────────────────────────────────
// YouTube / TikTok / Instagram. Gated behind a persisted toggle (default off).
const mediaRouter = router({
  getEnabled: publicProcedure.query(() => ({ enabled: isMediaEnabled() })),

  setEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      setMediaEnabled(input.enabled);
      try {
        await setSetting(
          "media_enabled",
          input.enabled ? "true" : "false",
          "boolean",
          null,
          "Global on/off switch for YouTube/TikTok/Instagram ingestion"
        );
      } catch (err) {
        await logger.warn("media", `Failed to persist media_enabled: ${String(err)}`);
      }
      return { enabled: input.enabled };
    }),

  detect: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .query(({ input }) => ({ platform: detectPlatform(input.url) })),

  ingest: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => ingestMediaUrl(input.url)),

  // Resolve a YouTube channel / handle / RSS URL to its canonical RSS feed
  // and persist it as a media-typed scrape_source. Returns the row that was
  // added so the UI can show it alongside regular sources.
  addChannel: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        intervalMinutes: z.number().int().min(5).max(10080).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const resolved = await resolveYouTubeChannelRss(input.url);
      if (!resolved) {
        throw new Error(
          "Could not resolve a YouTube channel from that URL. Paste a /channel/UC..., /@handle, or feeds/videos.xml?channel_id=... URL."
        );
      }
      await addScrapeSource({
        name: `[youtube] ${resolved.displayName}`,
        url: resolved.rssUrl,
        type: YOUTUBE_CHANNEL_TYPE,
        intervalMinutes: input.intervalMinutes ?? 60,
      });
      return {
        channelId: resolved.channelId,
        displayName: resolved.displayName,
        rssUrl: resolved.rssUrl,
      };
    }),

  // Manual trigger for the media scheduler — fires a tick immediately rather
  // than waiting for the 15 min interval.
  scrapeNow: publicProcedure.mutation(async () => {
    return scrapeMediaChannels();
  }),
});

// ── Self-Improvement Router ───────────────────────────────────────────────────
const selfImprovementRouter = router({
  listPatches: publicProcedure.query(() => getPatches(20)),

  runAnalysis: publicProcedure.mutation(async () => {
    return analyzeSelfForImprovements();
  }),

  analyzeFeed: publicProcedure.mutation(async () => {
    return analyzeImprovementFeed();
  }),

  analyzeKnowledge: publicProcedure.mutation(async () => {
    return analyzeKnowledge();
  }),

  // Knowledge-backed self-evaluation. Uses the entity graph + scraped
  // knowledge to review JARVIS's own source code. Takes 30-90 min on CPU.
  // Returns immediately — poll getPlan for progress.
  startEvaluation: publicProcedure.mutation(() => {
    const planId = startSelfEvaluation();
    return { planId };
  }),

  getPlan: publicProcedure.query(() => {
    return getSelfEvalPlan();
  }),

  cancelEvaluation: publicProcedure.mutation(() => {
    cancelEvaluation();
    return { success: true };
  }),

  updatePlanItem: publicProcedure
    .input(z.object({
      itemId: z.string(),
      status: z.enum(["accepted", "rejected", "modified"]).optional(),
      userNotes: z.string().optional(),
    }))
    .mutation(({ input }) => {
      return { success: updatePlanItem(input.itemId, input) };
    }),

  clearPlan: publicProcedure.mutation(() => {
    clearSelfEvalPlan();
    return { success: true };
  }),

  // Read-only view of the recent improvement feed events. Used by the
  // Self-Improve panel to show "what's been hurting" alongside the
  // proposed patches.
  listFeed: publicProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(({ input }) => readImprovementFeed(input?.limit ?? 50)),

  approveOrRejectPatch: publicProcedure
    .input(
      z.object({
        id: z.number(),
        action: z.enum(["approved", "rejected"]),
      })
    )
    .mutation(async ({ input }) => {
      await updatePatchStatus(input.id, input.action);
      return { success: true };
    }),

  applyPatch: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const patches = await getPatches(100);
      const patch = patches.find((p: any) => p.id === input.id);
      if (!patch) throw new TRPCError({ code: "NOT_FOUND" });
      return safeApplyCodeChange(patch.targetFile, patch.patchDiff, patch.suggestion);
    }),
});

// ── System Router ─────────────────────────────────────────────────────────────
const systemStatusRouter = router({
  status: publicProcedure.query(async () => {
    const ollamaUp = await isOllamaAvailable();
    const models = ollamaUp ? await listOllamaModels() : [];
    const knowledgeCount = await countKnowledgeChunks();
    const sources = await getScrapeSources();
    return {
      ollama: { available: ollamaUp, models },
      knowledge: { totalChunks: knowledgeCount },
      scraper: {
        totalSources: sources.length,
        activeSources: sources.filter((s: any) => s.isActive === true || s.isActive === 1).length,
      },
      entityGraph: getEntityGraphStats(),
    };
  }),

  logs: publicProcedure
    .input(z.object({ limit: z.number().default(100) }))
    .query(async ({ input }) => getSystemLogs(input.limit)),

  rates: publicProcedure.query(async () => getActivityRates()),

  // ── Entity graph browsing ────────────────────────────────────────────
  graphStats: publicProcedure.query(() => getEntityGraphStats()),

  searchEntities: publicProcedure
    .input(z.object({ query: z.string().min(1), limit: z.number().default(20) }))
    .query(({ input }) => {
      const results = searchEntitiesInGraph(input.query, input.limit);
      return results.map((e) => ({
        ...e,
        related: getRelatedEntitiesFromGraph(e.normalizedName, 10),
      }));
    }),

  // Returns a force-graph-ready data structure: { nodes, links }.
  // Centers on the searched entity, expands 1 hop, and includes inter-
  // neighbor edges so the graph shows the full local topology.
  exploreGraph: publicProcedure
    .input(z.object({ entity: z.string().min(1), depth: z.number().min(1).max(3).default(1) }))
    .query(({ input }) => {
      const nodeMap = new Map<string, { id: string; name: string; type: string; mentions: number }>();
      const linkSet = new Set<string>(); // "a|||b" dedup key
      const links: Array<{ source: string; target: string; strength: number }> = [];

      // Find the root entity
      const roots = searchEntitiesInGraph(input.entity, 1);
      if (roots.length === 0) return { nodes: [], links: [] };

      const root = roots[0];
      nodeMap.set(root.normalizedName, {
        id: root.normalizedName,
        name: root.name,
        type: root.type,
        mentions: root.mentionCount,
      });

      // BFS expansion
      let frontier = [root.normalizedName];
      for (let d = 0; d < input.depth; d++) {
        const nextFrontier: string[] = [];
        for (const name of frontier) {
          const related = getRelatedEntitiesFromGraph(name, 15);
          for (const rel of related) {
            // Add node
            if (!nodeMap.has(rel.normalizedName)) {
              nodeMap.set(rel.normalizedName, {
                id: rel.normalizedName,
                name: rel.name,
                type: rel.type,
                mentions: rel.mentionCount,
              });
              nextFrontier.push(rel.normalizedName);
            }
            // Add edge
            const key = [name, rel.normalizedName].sort().join("|||");
            if (!linkSet.has(key)) {
              linkSet.add(key);
              links.push({ source: name, target: rel.normalizedName, strength: rel.strength });
            }
          }
        }
        frontier = nextFrontier;
      }

      // Also add inter-neighbor edges (connections between the related
      // entities themselves). This makes the graph a mesh, not just a star.
      const allNames = Array.from(nodeMap.keys());
      for (const name of allNames) {
        const related = getRelatedEntitiesFromGraph(name, 15);
        for (const rel of related) {
          if (nodeMap.has(rel.normalizedName)) {
            const key = [name, rel.normalizedName].sort().join("|||");
            if (!linkSet.has(key)) {
              linkSet.add(key);
              links.push({ source: name, target: rel.normalizedName, strength: rel.strength });
            }
          }
        }
      }

      return {
        nodes: Array.from(nodeMap.values()),
        links,
        rootEntity: root.normalizedName,
      };
    }),
});

// ── Voice Router ──────────────────────────────────────────────────────────────
const voiceRouter = router({
  clone: publicProcedure
    .input(z.object({ text: z.string() }))
    .mutation(async ({ input }) => {
      const filepath = await cloneTrevorsVoice(input.text);
      return { filepath };
    }),
  analyzeStyle: publicProcedure
    .mutation(async () => {
      return await analyzeWritingStyle();
    }),

  getProfile: publicProcedure
    .query(() => {
      return loadVoiceProfile();
    }),

  writeInMyVoice: publicProcedure
    .input(z.object({
      topic: z.string(),
      length: z.enum(["short", "medium", "long"]).optional(),
      type: z.enum(["essay", "story", "analysis", "chapter"]).optional(),
    }))
    .mutation(async ({ input }) => {
      return await writeInTrevorsVoice(input.topic, input.length, input.type);
    }),

  testVoice: publicProcedure
    .input(z.object({
      voiceId: z.string(),
      text: z.string(),
      stability: z.number(),
      similarityBoost: z.number(),
    }))
    .mutation(async ({ input }) => {
      const path = await import("path");
      const filepath = await cloneVoiceElevenLabs(input.text, input.voiceId);
      return { audioUrl: `/api/audio/${path.basename(filepath)}` };
    }),
});

// ── Settings Router ──────────────────────────────────────────────────────────
const settingsRouter = router({
  saveVoiceSettings: publicProcedure
    .input(z.object({
      voiceId: z.string(),
      stability: z.number(),
      similarityBoost: z.number(),
    }))
    .mutation(async ({ input }) => {
      const fs = await import("fs");
      const path = await import("path");
      const configPath = path.join(process.cwd(), "voice-config.json");
      fs.writeFileSync(configPath, JSON.stringify(input, null, 2));
      return { success: true };
    }),

  getVoiceSettings: publicProcedure.query(async () => {
    const fs = await import("fs");
    const path = await import("path");
    const configPath = path.join(process.cwd(), "voice-config.json");
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
    return {
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      stability: 0.5,
      similarityBoost: 0.75,
    };
  }),
});

// ── Memory Router ─────────────────────────────────────────────────────────────
const memoryRouter = router({
  getFacts: publicProcedure
    .input(z.object({ query: z.string().optional(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      if (!input.query) {
        return getLearnedFacts(input.limit || 50);
      }
      return recallRelevantFacts(input.query, input.limit || 10);
    }),

  getEntities: publicProcedure
    .input(z.object({ query: z.string().optional(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      if (!input.query) {
        return getEntityMemory(input.limit || 50);
      }
      return recallEntities(input.query, input.limit || 10);
    }),

  processConversation: publicProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input }) => {
      await processConversationMemory(input.conversationId);
      return { success: true };
    }),
});

// ── LLM Settings Router ──────────────────────────────────────────────────────
const llmRouter = router({
  getSettings: publicProcedure
    .query(async () => {
      return await getAllSettings();
    }),

  getSetting: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ input }) => {
      return await getSetting(input.name);
    }),

  setSetting: publicProcedure
    .input(z.object({
      name: z.string(),
      value: z.string(),
      type: z.enum(["string", "number", "boolean", "json"]).optional(),
    }))
    .mutation(async ({ input }) => {
      await setSetting(input.name, input.value, input.type || "string");
      return { success: true };
    }),

  getPresets: publicProcedure
    .query(() => {
      return PRESETS;
    }),

  applyPreset: publicProcedure
    .input(z.object({ preset: z.string() }))
    .mutation(async ({ input }) => {
      await applyPreset(input.preset as any);
      return { success: true };
    }),

  // ── Creativity slider (0-10 → temperature 0.0-1.5) ────────────────────────
  // 0  = deterministic — use for books, factual writing, long-form
  // 5  = balanced default
  // 10 = maximum variation — use for brainstorming business ideas
  getCreativity: publicProcedure
    .query(async () => {
      const raw = await getSetting("creativity");
      const value = parseFloat(raw || "5");
      return { value: isNaN(value) ? 5 : value };
    }),

  setCreativity: publicProcedure
    .input(z.object({ value: z.number().min(0).max(10) }))
    .mutation(async ({ input }) => {
      await setSetting("creativity", String(input.value), "number");
      const { setTemperatureOverride } = await import("./ollama.js");
      setTemperatureOverride((input.value / 10) * 1.5);
      return { success: true };
    }),
});

// ── Image Generation Router ─────────────────────────────────────────────────
const imageRouter = router({
  generate: publicProcedure
    .input(z.object({
      prompt: z.string(),
      preferLocal: z.boolean().optional()
    }))
    .mutation(async ({ input }) => {
      try {
        const result = await generateImage(input.prompt, input.preferLocal);
        try {
          reflectOnAction(
            "generateImage",
            { prompt: input.prompt, preferLocal: input.preferLocal },
            `success: image saved via ${result.provider}`
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        } catch {}
        return result;
      } catch (err) {
        try {
          reflectOnAction(
            "generateImage",
            { prompt: input.prompt, preferLocal: input.preferLocal },
            `failure: ${String(err)}`
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        } catch {}
        throw err;
      }
    }),
});

// ── Video Generation Router ─────────────────────────────────────────────────
const videoRouter = router({
  start: publicProcedure
    .input(z.object({
      title: z.string(),
      sourceText: z.string().min(10).max(20000),
      style: z.enum(["documentary", "lecture", "story", "slideshow"]).optional(),
      voiceStyle: z.enum(["trevor", "local", "none"]).optional(),
      targetMinutes: z.number().min(0.5).max(30).nullable().optional(),
    }))
    .mutation(({ input }) => {
      try {
        const id = startVideoProject(input);
        try {
          reflectOnAction(
            "startVideoProject",
            { title: input.title, style: input.style, targetMinutes: input.targetMinutes },
            `started video project ${id}: ${input.title}`
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        } catch {}
        return { id };
      } catch (err) {
        try {
          reflectOnAction(
            "startVideoProject",
            { title: input.title, style: input.style },
            `failure: ${String(err)}`
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        } catch {}
        throw err;
      }
    }),

  getProject: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getVideoProject(input.id)),

  list: publicProcedure.query(() => listVideoProjects()),

  cancel: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      cancelVideoProject(input.id);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      deleteVideoProject(input.id);
      return { success: true };
    }),
});

// ── Stock Market Router ─────────────────────────────────────────────────────
const stockRouter = router({
  quote: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => getQuote(input.symbol)),

  overview: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => getCompanyOverview(input.symbol)),

  dailyPrices: publicProcedure
    .input(z.object({ symbol: z.string(), days: z.number().default(30) }))
    .query(async ({ input }) => getDailyPrices(input.symbol, input.days)),

  search: publicProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => searchSymbol(input.query)),

  news: publicProcedure
    .input(z.object({ tickers: z.string() }))
    .query(async ({ input }) => getStockNews(input.tickers)),

  analyze: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const result = await analyzeStock(input.symbol);
        try {
          reflectOnAction(
            "analyzeStock",
            { symbol: input.symbol },
            `analyzed ${input.symbol}: news=${result.news?.length ?? 0}, kg=${result.knowledgeConnections?.length ?? 0}`
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        } catch {}
        return result;
      } catch (err) {
        try {
          reflectOnAction(
            "analyzeStock",
            { symbol: input.symbol },
            `failure: ${String(err)}`
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        } catch {}
        throw err;
      }
    }),

  marketSummary: publicProcedure
    .query(async () => getMarketSummary()),

  // Alpha Vantage usage stats — free tier is 5/min, 500/day. Check this
  // to see how close you are to rate limits or daily caps.
  apiStats: publicProcedure
    .query(() => getAlphaVantageCallStats()),

  // Watchlist
  watchlist: publicProcedure.query(() => getWatchlist()),

  addToWatchlist: publicProcedure
    .input(z.object({
      symbol: z.string(),
      name: z.string().optional(),
      alertAbove: z.number().optional(),
      alertBelow: z.number().optional(),
      alertPercentChange: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(({ input }) => {
      addToWatchlist(input);
      return { success: true };
    }),

  removeFromWatchlist: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .mutation(({ input }) => {
      removeFromWatchlist(input.symbol);
      return { success: true };
    }),

  checkAlerts: publicProcedure
    .mutation(async () => checkWatchlistAlerts()),
});

// ── Integrity Router ────────────────────────────────────────────────────────
const integrityRouter = router({
  check: publicProcedure
    .input(z.object({ autoRepair: z.boolean().default(true) }).optional())
    .mutation(async ({ input }) => runIntegrityCheck(input?.autoRepair ?? true)),

  lastReport: publicProcedure.query(() => getIntegrityReport()),
});

// ── Unknown Scheduler Router ────────────────────────────────────────────────
const unknownSchedulerRouter = router({
  run: publicProcedure
    .input(z.object({ force: z.boolean().default(false) }).optional())
    .mutation(async ({ input }) => runUnknownScheduler(input?.force ?? false)),

  targets: publicProcedure
    .input(z.object({
      status: z.enum(["pending", "active", "resolved", "promoted"]).optional(),
      limit: z.number().default(50),
    }).optional())
    .query(({ input }) => listLearningTargets(input?.status, input?.limit ?? 50)),

  stats: publicProcedure.query(() => getLearningTargetsStats()),

  embedQueueStats: publicProcedure.query(() => getEmbedQueueStats()),

  resolveTarget: publicProcedure
    .input(z.object({ topic: z.string().min(1) }))
    .mutation(({ input }) => resolveTargetByTopic(input.topic)),
});

// ── PDF Folder-Watch Router ─────────────────────────────────────────────────
const pdfWatcherRouter = router({
  status: publicProcedure.query(async () => {
    const { getPdfWatcherStatus } = await import("./pdfWatcher.js");
    return getPdfWatcherStatus();
  }),
  runNow: publicProcedure.mutation(async () => {
    const { runPdfWatcherNow } = await import("./pdfWatcher.js");
    return runPdfWatcherNow();
  }),
});

// ── Self-Quiz Router ────────────────────────────────────────────────────────
const selfQuizRouter = router({
  stats: publicProcedure.query(async () => {
    const { getSelfQuizStats } = await import("./selfQuiz.js");
    return getSelfQuizStats();
  }),
  runs: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const { listQuizRuns } = await import("./selfQuiz.js");
      return listQuizRuns(input?.limit ?? 20);
    }),
  items: publicProcedure
    .input(z.object({ runId: z.number().int().positive(), limit: z.number().int().positive().max(500).default(100) }))
    .query(async ({ input }) => {
      const { listQuizItems } = await import("./selfQuiz.js");
      return listQuizItems(input.runId, input.limit);
    }),
  runNow: publicProcedure
    .input(z.object({ force: z.boolean().default(true) }).optional())
    .mutation(async ({ input }) => {
      const { runSelfQuiz } = await import("./selfQuiz.js");
      return runSelfQuiz(input?.force ?? true);
    }),
});

// ── Distillation Router ────────────────────────────────────────────────────
// Stats + browsing for cloud-LLM responses captured for the local fine-tune
// pipeline. Read-only (the consumption side runs from autoTrain).
const distillationRouter = router({
  stats: publicProcedure.query(async () => {
    const { getDistillationStats } = await import("./distillation.js");
    return getDistillationStats();
  }),
  /** Recent unconsumed batch — peek at what's pending for the next training run. */
  preview: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(10) }).optional())
    .query(async ({ input }) => {
      const { getUnconsumedBatch } = await import("./distillation.js");
      return getUnconsumedBatch(input?.limit ?? 10);
    }),
  /** Drop examples older than maxAgeDays. Manual trigger; auto-runs are
   *  not currently wired (the daily LoRA cycle handles consumption). */
  prune: publicProcedure
    .input(z.object({ maxAgeDays: z.number().int().positive().max(365).default(30) }).optional())
    .mutation(async ({ input }) => {
      const { pruneOldExamples } = await import("./distillation.js");
      return { dropped: pruneOldExamples(input?.maxAgeDays ?? 30) };
    }),
});

// ── Phone Notifications Router ─────────────────────────────────────────────
// Categorized push notifications via ntfy.sh. Send / list history / get stats.
const phoneNotifyRouter = router({
  /** What's configured? Used by the UI to show current setup. */
  status: publicProcedure.query(async () => {
    const { isConfigured, listConfiguredTopics } = await import("./phoneNotify.js");
    const { getListenerStatus } = await import("./phoneNotifyListener.js");
    return {
      configured: await isConfigured(),
      topics: listConfiguredTopics(),
      listener: getListenerStatus(),
    };
  }),

  /** Test send to verify the pipe works. Returns success/failure. */
  testSend: publicProcedure
    .input(
      z.object({
        category: z.enum(["alerts", "goals", "trades", "autonomous", "reminders", "calendar", "general"]).default("general"),
        title: z.string().min(1).max(200).default("Test from JARVIS"),
        body: z.string().min(1).max(2000).default("Phone notifications working."),
      }).optional()
    )
    .mutation(async ({ input }) => {
      const { notify } = await import("./phoneNotify.js");
      return notify(
        input?.title ?? "Test from JARVIS",
        input?.body ?? "Phone notifications working.",
        { category: input?.category ?? "general" }
      );
    }),

  /** Recent history (last N notifications, optional category filter). */
  history: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        limit: z.number().min(1).max(500).default(50),
        unackedOnly: z.boolean().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const { listNotifications } = await import("./phoneNotifyHistory.js");
      return listNotifications({
        category: input?.category,
        limit: input?.limit ?? 50,
        unackedOnly: input?.unackedOnly,
      });
    }),

  stats: publicProcedure.query(async () => {
    const { getNotificationStats } = await import("./phoneNotifyHistory.js");
    return getNotificationStats();
  }),
});

// ── Opinions Router ─────────────────────────────────────────────────────────
// JARVIS forms persistent views on topics; user can override at any time.
// User-overrides are locked: synthesis CAN'T silently displace them.
const opinionsRouter = router({
  list: publicProcedure
    .input(z.object({ onlyUserOverride: z.boolean().optional(), limit: z.number().int().positive().max(200).default(50) }).optional())
    .query(async ({ input }) => {
      const { listOpinions } = await import("./opinions.js");
      return listOpinions({ onlyUserOverride: input?.onlyUserOverride, limit: input?.limit ?? 50 });
    }),

  get: publicProcedure
    .input(z.object({ topic: z.string().min(1) }))
    .query(async ({ input }) => {
      const { getOpinion } = await import("./opinions.js");
      return getOpinion(input.topic);
    }),

  // Synthesize an opinion from current evidence. Returns null if no
  // chunks are retrievable for the topic, or returns the existing
  // user-override if one exists (synthesis won't displace it).
  form: publicProcedure
    .input(z.object({ topic: z.string().min(2).max(200) }))
    .mutation(async ({ input }) => {
      const { formOpinion } = await import("./opinions.js");
      return formOpinion(input.topic);
    }),

  // Multi-perspective: forces a steelman of both sides before settling.
  // Costs ~3x a regular form (bigger prompt + longer LLM response) but
  // produces a more defensible view. Use for contested topics.
  formMultiPerspective: publicProcedure
    .input(z.object({ topic: z.string().min(2).max(200) }))
    .mutation(async ({ input }) => {
      const { formMultiPerspective } = await import("./opinions.js");
      return formMultiPerspective(input.topic);
    }),

  // Manually trigger the periodic refresh — useful from a UI button.
  refreshStale: publicProcedure
    .input(z.object({ maxAgeDays: z.number().min(0).max(365).default(7), maxToProcess: z.number().min(1).max(100).default(20) }).optional())
    .mutation(async ({ input }) => {
      const { refreshStaleOpinions } = await import("./opinions.js");
      const maxAgeMs = (input?.maxAgeDays ?? 7) * 86400_000;
      return refreshStaleOpinions({ maxAgeMs, maxToProcess: input?.maxToProcess ?? 20 });
    }),

  // User explicitly states their view. Locks the opinion — confidence 1.0,
  // isUserOverride=1. Future synthesis on this topic returns this record
  // unchanged until clearOverride is called.
  setOverride: publicProcedure
    .input(
      z.object({
        topic: z.string().min(2).max(200),
        position: z.string().min(2).max(2000),
        reasoning: z.string().max(1000).optional(),
        confidence: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { setUserOverride } = await import("./opinions.js");
      return setUserOverride(input);
    }),

  // Unlock a user-override so future synthesis can re-form it.
  clearOverride: publicProcedure
    .input(z.object({ topic: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { clearUserOverride } = await import("./opinions.js");
      return { existed: clearUserOverride(input.topic) };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { deleteOpinion } = await import("./opinions.js");
      deleteOpinion(input.id);
      return { success: true };
    }),
});

// ── GitHub Repo Scraper Router ──────────────────────────────────────────────
const githubRepoRouter = router({
  list: publicProcedure.query(async () => {
    const { listWatchlist } = await import("./githubRepoScraper.js");
    return listWatchlist();
  }),
  stats: publicProcedure.query(async () => {
    const { getGithubScraperStats } = await import("./githubRepoScraper.js");
    return getGithubScraperStats();
  }),
  add: publicProcedure
    .input(z.object({
      owner: z.string().min(1).max(64),
      repo: z.string().min(1).max(128),
      branch: z.string().max(64).optional(),
    }))
    .mutation(async ({ input }) => {
      const { addWatchEntry } = await import("./githubRepoScraper.js");
      return addWatchEntry(input.owner, input.repo, input.branch);
    }),
  remove: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { removeWatchEntry } = await import("./githubRepoScraper.js");
      removeWatchEntry(input.id);
      return { success: true };
    }),
  toggle: publicProcedure
    .input(z.object({ id: z.number().int().positive(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const { setWatchEnabled } = await import("./githubRepoScraper.js");
      setWatchEnabled(input.id, input.enabled);
      return { success: true };
    }),
  runNow: publicProcedure
    .input(z.object({ force: z.boolean().default(false) }).optional())
    .mutation(async ({ input }) => {
      const { runGithubRepoScraper } = await import("./githubRepoScraper.js");
      return runGithubRepoScraper(input?.force ?? true);
    }),
});

// ── Note Enrichment Router ──────────────────────────────────────────────────
const noteEnrichmentRouter = router({
  enrich: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1).max(64),
        text: z.string().max(4000),
      })
    )
    .mutation(async ({ input }) => {
      const { enrichNoteChunk } = await import("./noteEnrichment.js");
      return enrichNoteChunk(input);
    }),

  reset: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      const { resetSession } = await import("./noteEnrichment.js");
      resetSession(input.sessionId);
      return { success: true };
    }),

  stats: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const { getSessionStats } = await import("./noteEnrichment.js");
      return getSessionStats(input.sessionId);
    }),
});

// ── Trading Router ──────────────────────────────────────────────────────────
const tradingRouter = router({
  // Account & positions
  account: publicProcedure.query(async () => getAccount()),
  positions: publicProcedure.query(async () => getPositions()),
  orders: publicProcedure
    .input(z.object({ status: z.string().default("all"), limit: z.number().default(50) }).optional())
    .query(async ({ input }) => getOrders(input?.status, input?.limit)),

  // Place trade
  trade: publicProcedure
    .input(z.object({
      symbol: z.string(),
      side: z.enum(["buy", "sell"]),
      qty: z.number().min(1),
      type: z.enum(["market", "limit"]).default("market"),
      limitPrice: z.number().optional(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const result = await placeTrade(input);
        try {
          const tradeOutcome = result.error
            ? `blocked: ${result.error}`
            : result.pendingId
            ? `pending approval (${result.pendingId})`
            : `placed: status=${result.order?.status}`;
          reflectOnAction(
            "placeTrade",
            { symbol: input.symbol, side: input.side, qty: input.qty, type: input.type },
            tradeOutcome
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        } catch {}
        return result;
      } catch (err) {
        try {
          reflectOnAction(
            "placeTrade",
            { symbol: input.symbol, side: input.side, qty: input.qty, type: input.type },
            `failure: ${String(err)}`
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        } catch {}
        throw err;
      }
    }),

  cancelOrder: publicProcedure
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ input }) => { await cancelOrder(input.orderId); return { success: true }; }),

  closePosition: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .mutation(async ({ input }) => closePosition(input.symbol)),

  // Approval system
  pendingTrades: publicProcedure.query(() => getPendingTrades()),
  approve: publicProcedure
    .input(z.object({ pendingId: z.string() }))
    .mutation(async ({ input }) => approveTrade(input.pendingId)),
  reject: publicProcedure
    .input(z.object({ pendingId: z.string() }))
    .mutation(({ input }) => { rejectTrade(input.pendingId); return { success: true }; }),

  // AI recommendation
  recommend: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .mutation(async ({ input }) => getTradeRecommendation(input.symbol)),

  // Config
  config: publicProcedure.query(() => getTradingConfig()),
  setMode: publicProcedure
    .input(z.object({ mode: z.enum(["off", "paper", "approval", "auto"]) }))
    .mutation(({ input }) => { setTradingMode(input.mode as TradingMode); return { success: true, mode: input.mode }; }),
  updateConfig: publicProcedure
    .input(z.object({
      maxPositionDollars: z.number().optional(),
      maxDailySpend: z.number().optional(),
      maxPortfolioPercent: z.number().optional(),
      defaultStopLossPercent: z.number().optional(),
      blockedTickers: z.array(z.string()).optional(),
      requireConfirmation: z.boolean().optional(),
      largeTradeThreshold: z.number().optional(),
    }))
    .mutation(({ input }) => { updateTradingConfig(input); return { success: true }; }),

  // History
  history: publicProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(({ input }) => getTradeHistory(input?.limit)),
});

// ── Book Writer Router ──────────────────────────────────────────────────────
const bookRouter = router({
  list: publicProcedure.query(() => listBooks()),

  get: publicProcedure
    .input(z.object({ bookId: z.string() }))
    .query(({ input }) => getBook(input.bookId)),

  create: publicProcedure
    .input(
      z.object({
        // No character limits — Express allows 50MB payloads, which is far
        // more than any realistic book spec. The more context the user
        // provides, the better the output.
        title: z.string().min(1),
        description: z.string().default(""),
        introduction: z.string().optional(),
        chapters: z
          .array(
            z.object({
              title: z.string().min(1),
              notes: z.string().optional(),
              partTitle: z.string().optional(),
            })
          )
          .min(1),
        voiceProfile: z.boolean().default(true),
        targetParagraphsPerChapter: z.number().int().min(3).max(200).default(10),
        targetWordCount: z.number().int().min(1).optional(),
        targetPages: z.number().int().min(1).optional(),
        additionalInfo: z.string().optional(),
      })
    )
    .mutation(({ input }) => createBook(input)),

  update: publicProcedure
    .input(
      z.object({
        bookId: z.string(),
        title: z.string().min(1),
        description: z.string().default(""),
        introduction: z.string().optional(),
        chapters: z
          .array(
            z.object({
              title: z.string().min(1),
              notes: z.string().optional(),
              partTitle: z.string().optional(),
            })
          )
          .min(1),
        voiceProfile: z.boolean().default(true),
        targetParagraphsPerChapter: z.number().int().min(3).max(200).default(10),
        targetWordCount: z.number().int().min(1).optional(),
        targetPages: z.number().int().min(1).optional(),
        additionalInfo: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const { bookId, ...rest } = input;
      return updateBook(bookId, rest);
    }),

  start: publicProcedure
    .input(z.object({ bookId: z.string() }))
    .mutation(({ input }) => startBookWriting(input.bookId)),

  resume: publicProcedure
    .input(z.object({ bookId: z.string() }))
    .mutation(({ input }) => resumeBook(input.bookId)),

  unpause: publicProcedure
    .input(z.object({ bookId: z.string() }))
    .mutation(({ input }) => unpauseBook(input.bookId)),

  intervene: publicProcedure
    .input(
      z.object({
        bookId: z.string(),
        action: z.enum(["pause", "change", "continue"]),
        feedback: z.string().max(20000).optional(),
      })
    )
    .mutation(({ input }) => submitBookIntervention(input)),

  delete: publicProcedure
    .input(z.object({ bookId: z.string() }))
    .mutation(({ input }) => ({ success: deleteBook(input.bookId) })),

  exportMarkdown: publicProcedure
    .input(z.object({ bookId: z.string() }))
    .query(({ input }) => ({ markdown: exportBookAsMarkdown(input.bookId) })),
});

// ── Code Execution Router ───────────────────────────────────────────────────
const codeRouter = router({
  execute: publicProcedure
    .input(z.object({
      code: z.string(),
      language: z.enum(["javascript", "python", "swift"]).optional(),
    }))
    .mutation(async ({ input }) => {
      return await executeCode(input.code, input.language);
    }),

  generate: publicProcedure
    .input(z.object({
      task: z.string(),
      language: z.enum(["swift", "python", "javascript", "typescript", "java", "cpp"]),
      includeTests: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      return await generateCode(input.task, input.language, input.includeTests);
    }),

  review: publicProcedure
    .input(z.object({
      code: z.string(),
      language: z.enum(["swift", "python", "javascript", "typescript"]),
    }))
    .mutation(async ({ input }) => {
      return await reviewCode(input.code, input.language);
    }),

  explain: publicProcedure
    .input(z.object({
      code: z.string(),
      language: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await explainCode(input.code, input.language);
    }),

  fix: publicProcedure
    .input(z.object({
      code: z.string(),
      error: z.string(),
      language: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await fixCode(input.code, input.error, input.language);
    }),
});

// ── Web Search Router ───────────────────────────────────────────────────────
const searchRouter = router({
  web: publicProcedure
    .input(z.object({
      query: z.string(),
      maxResults: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return await searchWeb(input.query, input.maxResults);
    }),

  summarize: publicProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      return await searchAndSummarize(input.query);
    }),
});

// ── Training Router ─────────────────────────────────────────────────────────
const trainingRouter = router({
  rateMessage: publicProcedure
    .input(z.object({
      messageId: z.number(),
      rating: z.number().min(1).max(5),
    }))
    .mutation(async ({ input }) => {
      const message = await getMessageById(input.messageId);

      if (!message) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await updateMessageRating(input.messageId, input.rating);

      if (input.rating >= 4 && message.role === "assistant") {
        const userMessages = await getMessagesBeforeId(
          message.conversationId,
          message.id,
          1
        );

        if (userMessages[0]) {
          await collectTrainingExample(
            message.conversationId,
            userMessages[0].content,
            message.content,
            input.rating
          );
        }
      }

      return { success: true };
    }),

  getStats: publicProcedure.query(async () => {
    return await getTrainingStats();
  }),

  trainNewModel: publicProcedure.mutation(async () => {
    const dataPath = await exportTrainingData("general", 4, 1000);

    trainNewModel(dataPath).catch(err =>
      logger.error("training", `Training failed: ${err}`)
    );

    return { success: true, message: "Training started in background" };
  }),

  trainSpecialized: publicProcedure
    .input(z.object({
      specialty: z.enum(["ios", "web", "data"]),
    }))
    .mutation(async ({ input }) => {
      trainSpecializedModel(input.specialty).catch(err =>
        logger.error("training", `Training failed: ${err}`)
      );

      return {
        success: true,
        specialty: input.specialty,
        message: `${input.specialty} training started`
      };
    }),

  // Convert knowledge chunks into synthetic training examples on demand.
  // Runs inline (not backgrounded) so the caller gets the counts back.
  generateFromSources: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await generateTrainingFromChunks(input.limit ?? 50);
      return { success: true, ...result };
    }),
});

// Multi-Agent Swarm Router
const multiAgentRouter = router({
  // Process complex query with agent swarm
  processQuery: publicProcedure
    .input(z.object({
      query: z.string(),
      conversationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const result = await processWithAgentSwarm(input.query);
        return {
          success: true,
          result: result,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message,
        };
      }
    }),

  // Get agent status
  getStatus: publicProcedure.query(async () => {
    return getAgentStatus();
  }),
});

// ── Writing Profile Router ────────────────────────────────────────────────────
// Personal writing samples for voice learning. SEPARATE from the regular
// knowledge base — these never feed RAG, only the chat system prompt.
const writingProfileRouter = router({
  // List all uploaded samples (metadata only — rawText is too big to ship
  // on every list call).
  listSamples: publicProcedure.query(async () => {
    const samples = await listWritingSamplesModule();
    return samples.map((s) => ({
      id: s.id,
      originalName: s.originalName,
      category: s.category,
      description: s.description,
      wordCount: s.wordCount,
      analyzed: !!s.analyzedAt,
      analyzedAt: s.analyzedAt,
      createdAt: s.createdAt,
    }));
  }),

  // Return an aggregated profile. Without a `category` param returns the
  // combined "all" profile. With a category returns that category-specific
  // profile, or falls back to "all" if that category has no samples yet.
  getProfile: publicProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return getWritingProfileModule(input?.category ?? "all");
    }),

  // List every profile category that has been trained (one row per
  // category + one "all"). Lets the UI show tabs/selector.
  listCategories: publicProcedure.query(async () => {
    return listProfileCategoriesModule();
  }),

  // Force a profile rebuild across all currently-stored samples. Useful
  // after deleting samples or after an LLM upgrade so the profile reflects
  // the latest analyses.
  regenerate: publicProcedure.mutation(async () => {
    const profile = await regenerateWritingProfile();
    return { success: true, profile };
  }),

  // Rebuild a single category's profile (plus the combined "all" profile
  // since it spans everything). Cheap re-aggregation over already-analyzed
  // samples — doesn't re-run LLM analysis.
  regenerateCategory: publicProcedure
    .input(
      z.object({
        category: z.enum(["essay", "lab_report", "book_report", "resume", "book", "article", "other", "all"]),
      })
    )
    .mutation(async ({ input }) => {
      const profile = await regenerateProfileForCategoryModule(input.category);
      return { success: true, profile };
    }),

  // Change a sample's category, then re-analyze + re-aggregate all
  // profiles. Used when the user realizes a sample was mis-labeled or
  // wants to move it to a different voice bucket.
  updateSampleCategory: publicProcedure
    .input(
      z.object({
        sampleId: z.number(),
        category: z.enum(["essay", "lab_report", "book_report", "resume", "book", "article", "other"]),
      })
    )
    .mutation(async ({ input }) => {
      const changed = await updateWritingSampleCategoryModule(input.sampleId, input.category);
      return { success: changed };
    }),

  // Delete a sample by id. Also unlinks the file on disk and re-aggregates
  // the profile.
  deleteSample: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteWritingSampleModule(input.id);
      return { success: true };
    }),
});

// ── Navigator Router ──────────────────────────────────────────────────────────
// Playwright-driven browser automation. See server/navigator.ts for the
// safety model. Every destructive action requires explicit user approval
// via the approveAction mutation.
const navigatorRouter = router({
  startTask: publicProcedure
    .input(
      z.object({
        goal: z.string().min(5),
        allowlist: z.array(z.string()).optional(),
        maxSteps: z.number().min(1).max(30).optional(),
        allowDestructive: z.boolean().optional(),
        highStakes: z.boolean().optional(),
        headless: z.boolean().optional(),
        sessionId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const taskId = await startNavigationTask(input);
        try {
          reflectOnAction(
            "startNavigationTask",
            { goal: input.goal, allowlist: input.allowlist, highStakes: input.highStakes },
            `started navigator task ${taskId}`
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        } catch {}
        return { taskId };
      } catch (err) {
        try {
          reflectOnAction(
            "startNavigationTask",
            { goal: input.goal, highStakes: input.highStakes },
            `failure: ${String(err)}`
          ).catch((e) => console.warn("[bg] fire-and-forget failed:", String(e).slice(0, 200)));
        } catch {}
        throw err;
      }
    }),

  // Return the current state of a single run (used for polling while the
  // agent is working). Omits extractedText to keep the payload small; the
  // UI can request the full run for a detailed view.
  getRun: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => {
      const run = getNavRun(input.taskId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown taskId" });
      return run;
    }),

  listRuns: publicProcedure.query(() => {
    // Strip the rawText extract fields for list view to keep it lightweight.
    return listNavRuns().map((r) => ({
      taskId: r.taskId,
      goal: r.goal,
      status: r.status,
      stepCount: r.steps.length,
      finalResult: r.finalResult,
      error: r.error,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      pendingAction: r.pendingAction,
    }));
  }),

  stopTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ input }) => {
      await stopNavTask(input.taskId);
      return { success: true };
    }),

  // Approve or reject a pending destructive action (simple single-click
  // confirmation for non-high-stakes tasks).
  resolvePending: publicProcedure
    .input(z.object({ taskId: z.string(), approve: z.boolean() }))
    .mutation(async ({ input }) => {
      await resolveNavPending(input.taskId, input.approve);
      return { success: true };
    }),

  // Typed-confirmation approval for high-stakes tasks. User must type the
  // exact requiredConfirmationPhrase. Anything else rejects and logs.
  resolveTyped: publicProcedure
    .input(z.object({ taskId: z.string(), userText: z.string() }))
    .mutation(async ({ input }) => {
      return resolveNavTyped(input.taskId, input.userText);
    }),

  // ── Sessions (credential passthrough) ────────────────────────────────
  listSessions: publicProcedure.query(async () => {
    return listNavSessions();
  }),

  beginCapture: publicProcedure
    .input(z.object({ startUrl: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      return beginCaptureSession(input?.startUrl);
    }),

  finalizeCapture: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const session = await finalizeCaptureSession(input.name, input.description ?? null);
      return session;
    }),

  cancelCapture: publicProcedure.mutation(async () => {
    await cancelCaptureSession();
    return { success: true };
  }),

  deleteSession: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteNavSession(input.id);
      return { success: true };
    }),

  // ── Audit log (high-stakes decisions) ────────────────────────────────
  listAuditLog: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      return listNavAuditLog(input?.limit ?? 100);
    }),
});

// ── System Control Router ────────────────────────────────────────────────────
const systemControlRouter = router({
  openApp: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => openApp(input.name)),

  openUrl: publicProcedure
    .input(z.object({ url: z.string() }))
    .mutation(async ({ input }) => openUrl(input.url)),

  openFile: publicProcedure
    .input(z.object({ path: z.string() }))
    .mutation(async ({ input }) => openFile(input.path)),

  listProcesses: publicProcedure.query(async () => listProcesses()),

  killProcess: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => killProcess(input.name)),

  getSystemInfo: publicProcedure.query(async () => getSystemInfo()),

  runCommand: publicProcedure
    .input(z.object({ command: z.string() }))
    .mutation(async ({ input }) => runCommand(input.command)),

  takeScreenshot: publicProcedure.mutation(async () => takeScreenshot()),

  setClipboard: publicProcedure
    .input(z.object({ text: z.string() }))
    .mutation(async ({ input }) => setClipboard(input.text)),
});

// ── Scheduler Router ─────────────────────────────────────────────────────────
const schedulerRouter = router({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(500),
        type: z.enum(["reminder", "recurring", "interval"]),
        cronExpression: z.string().nullish(),
        timestamp: z.number().nullish(),
        intervalMs: z.number().nullish(),
        action: z.enum(["notify", "run-command", "chat-message"]).default("notify"),
        payload: z.string().default(""),
      })
    )
    .mutation(async ({ input }) => {
      return createTask({
        name: input.name,
        type: input.type,
        cronExpression: input.cronExpression ?? null,
        timestamp: input.timestamp ?? null,
        intervalMs: input.intervalMs ?? null,
        action: input.action,
        payload: input.payload,
      });
    }),

  list: publicProcedure.query(async () => {
    return listTasks();
  }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return deleteTask(input.id);
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        action: z.enum(["notify", "run-command", "chat-message"]).optional(),
        payload: z.string().optional(),
        cronExpression: z.string().nullish(),
        timestamp: z.number().nullish(),
        intervalMs: z.number().nullish(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      return updateTask(id, updates);
    }),

  pause: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return pauseTask(input.id);
    }),
});

// ── Webhook Router ───────────────────────────────────────────────────────────
const webhookRouter = router({
  list: publicProcedure.query(() => {
    return listWebhooks();
  }),

  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        action: z.enum(["notify", "ingest", "chat", "run-task"]),
        secret: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      return registerWebhook(input.name, input.action as WebhookAction, input.secret);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => {
      deleteWebhook(input.id);
      return { success: true };
    }),
});

// ── CSV Analysis Router ─────────────────────────────────────────────────────
const csvRouter = router({
  analyze: publicProcedure
    .input(z.object({
      csvText: z.string(),
      delimiter: z.string().optional(),
      hasHeaders: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const data = parseCSV(input.csvText, {
        delimiter: input.delimiter,
        hasHeaders: input.hasHeaders,
      });
      const analysis = analyzeData(data);
      const summary = summarize(data);
      return { data, analysis, summary };
    }),

  filter: publicProcedure
    .input(z.object({
      csvText: z.string(),
      conditions: z.array(z.object({
        column: z.string(),
        op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "startsWith", "endsWith"]),
        value: z.string(),
      })),
      delimiter: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const data = parseCSV(input.csvText, { delimiter: input.delimiter });
      const filtered = filterData(data, input.conditions as FilterCondition[]);
      return filtered;
    }),

  groupBy: publicProcedure
    .input(z.object({
      csvText: z.string(),
      groupColumn: z.string(),
      aggregations: z.array(z.object({
        column: z.string(),
        type: z.enum(["sum", "avg", "count", "min", "max"]),
      })),
      delimiter: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const data = parseCSV(input.csvText, { delimiter: input.delimiter });
      return groupBy(data, input.groupColumn, input.aggregations as { column: string; type: AggregationType }[]);
    }),

  summarize: publicProcedure
    .input(z.object({
      csvText: z.string(),
      delimiter: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const data = parseCSV(input.csvText, { delimiter: input.delimiter });
      return { summary: summarize(data), analysis: analyzeData(data) };
    }),
});

// ── Video Editing Router ────────────────────────────────────────────────────
const videoEditRouter = router({
  trim: publicProcedure
    .input(z.object({
      inputPath: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      outputPath: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await trimVideo(input.inputPath, input.startTime, input.endTime, input.outputPath);
    }),

  merge: publicProcedure
    .input(z.object({
      inputPaths: z.array(z.string()).min(2),
      outputPath: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await mergeVideos(input.inputPaths, input.outputPath);
    }),

  subtitles: publicProcedure
    .input(z.object({
      videoPath: z.string(),
      subtitleTextOrPath: z.string(),
      outputPath: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await addSubtitles(input.videoPath, input.subtitleTextOrPath, input.outputPath);
    }),

  extractAudio: publicProcedure
    .input(z.object({
      videoPath: z.string(),
      outputPath: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await extractAudio(input.videoPath, input.outputPath);
    }),

  info: publicProcedure
    .input(z.object({ videoPath: z.string() }))
    .query(async ({ input }) => {
      return await getVideoInfo(input.videoPath);
    }),

  thumbnail: publicProcedure
    .input(z.object({
      videoPath: z.string(),
      timestamp: z.string(),
      outputPath: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await generateThumbnail(input.videoPath, input.timestamp, input.outputPath);
    }),
});

// ── Notify Router (ntfy.sh phone push notifications) ────────────────────────
const notifyRouter = router({
  testNotification: publicProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      message: z.string().min(1).max(2000),
      priority: z.number().min(1).max(5).optional(),
      tags: z.array(z.string()).optional(),
      category: z.enum([
        "alerts", "goals", "trades", "autonomous",
        "reminders", "calendar", "general",
      ]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { notify } = await import("./phoneNotify.js");
      const sent = await notify(input.title, input.message, {
        category: input.category ?? "general",
        priority: input.priority,
        tags: input.tags,
      });
      return { success: sent };
    }),

  configure: publicProcedure
    .input(z.object({ topic: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => {
      await configureTopic(input.topic);
      return { success: true, topic: input.topic };
    }),

  isConfigured: publicProcedure.query(async () => {
    return { configured: await isNotifyConfigured() };
  }),
});

// ── Data Feed Router (free APIs, no keys) ───────────────────────────────────
const dataFeedRouter = router({
  weather: publicProcedure
    .input(z.object({ city: z.string().min(1) }))
    .query(async ({ input }) => getWeather(input.city)),

  cryptoPrice: publicProcedure
    .input(z.object({ coin: z.string().min(1) }))
    .query(async ({ input }) => getCryptoPrice(input.coin)),

  headlines: publicProcedure
    .input(z.object({ topic: z.string().optional() }))
    .query(async ({ input }) => getHeadlines(input.topic)),

  timeInZone: publicProcedure
    .input(z.object({ timezone: z.string().min(1) }))
    .query(({ input }) => getTimeInZone(input.timezone)),

  randomFact: publicProcedure.query(async () => getRandomFact()),

  dailyQuote: publicProcedure.query(async () => getDailyQuote()),

  ipInfo: publicProcedure.query(async () => getIPInfo()),

  defineWord: publicProcedure
    .input(z.object({ word: z.string().min(1) }))
    .query(async ({ input }) => defineWord(input.word)),

  exchangeRate: publicProcedure
    .input(z.object({ from: z.string().min(3).max(3), to: z.string().min(3).max(3) }))
    .query(async ({ input }) => getExchangeRate(input.from, input.to)),
});

// ── Planner Router ──────────────────────────────────────────────────────────
const plannerRouter = router({
  // List all tools exposed to the planner (for UI display).
  listTools: publicProcedure.query(() => listPlannerTools()),

  // Plan a task without executing — returns the generated plan.
  plan: publicProcedure
    .input(z.object({ userRequest: z.string().min(1).max(4000) }))
    .mutation(async ({ input }) => {
      const plan = await planTask(input.userRequest);
      return { plan };
    }),

  // Plan and execute in one call — returns the full execution trace.
  execute: publicProcedure
    .input(z.object({ userRequest: z.string().min(1).max(4000) }))
    .mutation(async ({ input }) => {
      return await planAndExecute(input.userRequest);
    }),

  // Execute a pre-made plan (useful for re-running / UI-edited plans).
  executeExistingPlan: publicProcedure
    .input(z.object({
      plan: z.array(z.any()),
      userRequest: z.string().default(""),
    }))
    .mutation(async ({ input }) => {
      return await executePlan(input.plan as Plan, input.userRequest);
    }),
});

// ── Reflection Router ───────────────────────────────────────────────────────
// Surface the post-action reflections layer to the UI: list recent
// reflections, query by action type, view aggregate stats, and let the
// user (or another module) record a manual reflection entry.
const reflectionRouter = router({
  list: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(50) }).optional())
    .query(({ input }) => {
      return getRecentReflections(input?.limit ?? 50);
    }),

  getByType: publicProcedure
    .input(z.object({ actionType: z.string().min(1), limit: z.number().min(1).max(500).default(50) }))
    .query(({ input }) => {
      return getReflectionsByType(input.actionType, input.limit);
    }),

  stats: publicProcedure.query(() => {
    return getReflectionStats();
  }),

  recordManual: publicProcedure
    .input(
      z.object({
        actionType: z.string().min(1).max(100),
        payload: z.any().optional(),
        outcome: z.enum(["success", "partial", "failure"]),
        confidence: z.number().min(0).max(1).default(0.5),
        lesson: z.string().min(1).max(2000),
        tags: z.array(z.string()).optional(),
      })
    )
    .mutation(({ input }) => {
      const id = recordReflection(
        input.actionType,
        input.payload ?? null,
        input.outcome,
        input.confidence,
        input.lesson,
        input.tags ?? []
      );
      return { id, success: id > 0 };
    }),
});

// ── Goal Router ───────────────────────────────────────────────────────────────
const goalStatusEnum = z.enum(["active", "paused", "completed", "abandoned"]);
const subtaskStatusEnum = z.enum(["pending", "in_progress", "complete", "blocked"]);

const goalRouter = router({
  list: publicProcedure
    .input(z.object({ status: goalStatusEnum.optional() }).optional())
    .query(({ input }) => listGoals(input?.status)),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => {
      const g = getGoal(input.id);
      if (!g) throw new TRPCError({ code: "NOT_FOUND" });
      return g;
    }),

  create: publicProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        deadline: z.number().nullable().optional(),
        decompose: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => createGoal(input)),

  updateStatus: publicProcedure
    .input(z.object({ id: z.number(), status: goalStatusEnum }))
    .mutation(async ({ input }) => {
      await updateGoalStatus(input.id, input.status);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteGoal(input.id);
      return { success: true };
    }),

  addSubtask: publicProcedure
    .input(
      z.object({
        goalId: z.number(),
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
      })
    )
    .mutation(({ input }) => addSubtask(input.goalId, input.title, input.description ?? "")),

  updateSubtaskStatus: publicProcedure
    .input(
      z.object({
        goalId: z.number(),
        subtaskId: z.number(),
        status: subtaskStatusEnum,
      })
    )
    .mutation(async ({ input }) => {
      await updateSubtaskStatus(input.goalId, input.subtaskId, input.status);
      return { success: true };
    }),

  deleteSubtask: publicProcedure
    .input(z.object({ goalId: z.number(), subtaskId: z.number() }))
    .mutation(async ({ input }) => {
      await deleteSubtask(input.goalId, input.subtaskId);
      return { success: true };
    }),

  activeContext: publicProcedure.query(async () => ({
    context: await getActiveGoalsContext(),
  })),

  checkDeadlines: publicProcedure.query(async () => checkGoalDeadlines()),
});

// ── Active Learning Router ────────────────────────────────────────────────────
// Captures corrections and confusion events so JARVIS gets better at the
// specific things it gets wrong. Every correction flows into the weekly
// auto-train run as a high-priority training pair.
const activeLearningRouter = router({
  // Record a user-supplied correction for an assistant response.
  submitCorrection: publicProcedure
    .input(
      z.object({
        conversationId: z.number().nullable().optional(),
        messageId: z.number().nullable().optional(),
        original: z.string().min(1).max(20000),
        corrected: z.string().min(1).max(20000),
        feedback: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const id = await recordCorrection(
          input.conversationId ?? null,
          input.messageId ?? null,
          input.original,
          input.corrected,
          input.feedback
        );
        // Agreement signal: if the corrected response touched on a topic
        // we have a (non-locked) opinion about, drop that opinion's
        // confidence. The correction is evidence the position was wrong.
        // Doesn't displace the position immediately — just lowers confidence
        // so future surfacing hedges more, and if many corrections stack
        // the next refresh cycle re-synthesizes from scratch.
        try {
          const { listOpinions, adjustOpinionConfidence, normalizeTopic } = await import("./opinions.js");
          const corrected = (input.corrected || "").toLowerCase();
          const original = (input.original || "").toLowerCase();
          const allOpinions = listOpinions({ limit: 200 });
          for (const op of allOpinions) {
            if (op.isUserOverride) continue;
            const topicNorm = normalizeTopic(op.topic);
            const tokens = topicNorm.split(" ").filter((t) => t.length >= 4);
            // Opinion was likely surfaced if the original response mentioned
            // any of its topic tokens.
            const surfaced = tokens.some((t) => original.includes(t));
            if (!surfaced) continue;
            // Bigger drop if the correction text directly contradicts the
            // opinion's position; smaller drop if the topic just got
            // reframed without explicit pushback on JARVIS's view.
            const corrected_mentions = tokens.some((t) => corrected.includes(t));
            const delta = corrected_mentions ? -0.15 : -0.05;
            adjustOpinionConfidence(op.topic, delta);
          }
        } catch { /* non-critical agreement-signal hook */ }
        return { success: true, id };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to record correction: ${String(err)}`,
        });
      }
    }),

  // List recent corrections for review in the UI.
  listCorrections: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(500).default(50),
      }).default({ limit: 50 })
    )
    .query(({ input }) => {
      return listCorrectionRows(input.limit);
    }),

  // Aggregated weakness topics across recent corrections + confusions.
  weaknessTopics: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
      }).default({ limit: 20 })
    )
    .query(({ input }) => {
      return getWeaknessTopics(input.limit);
    }),

  // Summary stats — totals, this-week counts, top topics.
  stats: publicProcedure.query(() => {
    return getCorrectionStats();
  }),

  // Export current corrections to a JSONL file under training-data/.
  exportTraining: publicProcedure.mutation(async () => {
    try {
      const filepath = await exportCorrectionsForTraining();
      if (!filepath) {
        return { success: true, filepath: null, message: "No corrections to export" };
      }
      return { success: true, filepath, message: `Exported to ${filepath}` };
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Export failed: ${String(err)}`,
      });
    }
  }),

  // Kick off weakness-topic scraping (logs to improvement feed; optionally
  // triggers source discovery when available).
  triggerWeaknessScrape: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
      }).default({ limit: 10 })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await scrapeWeakTopics(input.limit);
        return { success: true, ...result };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Weakness scrape failed: ${String(err)}`,
        });
      }
    }),
});

const loraRouter = router({
  config: publicProcedure.query(() => getLoraConfig()),

  runCycle: publicProcedure
    .input(
      z
        .object({
          baseModel: z.string().optional(),
          useLlmJudge: z.boolean().default(false),
          force: z.boolean().default(false),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      return runTrainingCycle({
        baseModel: input?.baseModel,
        useLlmJudge: input?.useLlmJudge,
        force: input?.force,
      });
    }),

  listRuns: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(20) }).optional())
    .query(({ input }) => listTrainingRuns(input?.limit ?? 20)),

  listEvals: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(20) }).optional())
    .query(({ input }) => listEvalRuns(input?.limit ?? 20)),
});

const benchmarksRouter = router({
  datasets: publicProcedure.query(() => getAvailableDatasets()),

  run: publicProcedure
    .input(
      z.object({
        benchmark: z.enum(["mmlu", "gsm8k", "humaneval"]),
        limit: z.number().int().min(1).max(10000).optional(),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return runBenchmark({
        benchmark: input.benchmark,
        limit: input.limit,
        model: input.model,
      });
    }),

  history: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(20) }).optional())
    .query(({ input }) => listBenchmarkRuns(input?.limit ?? 20)),
});

const metaRouter = router({
  settings: publicProcedure.query(() => getMetaSettings()),

  setConfidenceThreshold: publicProcedure
    .input(z.object({ value: z.number().min(0).max(1) }))
    .mutation(({ input }) => ({ value: setConfidenceThreshold(input.value) })),

  setAutonomyEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => ({ enabled: setAutonomyEnabled(input.enabled) })),

  setOfflineMode: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => ({ enabled: setOfflineMode(input.enabled) })),

  autonomyStatus: publicProcedure.query(() => getAutonomyStatus()),

  runAutonomyTick: publicProcedure.mutation(async () => {
    await runAutonomyTickNow();
    return getAutonomyStatus();
  }),

  confidenceStats: publicProcedure
    .input(z.object({ windowHours: z.number().min(1).max(24 * 365).default(168) }).optional())
    .query(({ input }) => computeConfidenceStats(input?.windowHours ?? 168)),
});

// ── Tunnel Router ────────────────────────────────────────────────────────────
// Cloudflare Tunnel setup wizard. Backs the admin-only TunnelSetupPanel.
// Operations are user-initiated; everything that touches cloudflared is
// async-shelled because the CLI is interactive (login opens a browser, etc.).
const tunnelRouter = router({
  /** Full state snapshot — what's installed, authenticated, configured. */
  state: publicProcedure.query(async () => {
    const { getTunnelState } = await import("./v16/tunnelSetup.js");
    return getTunnelState();
  }),

  /** Kick off `winget install Cloudflare.cloudflared`. Returns immediately. */
  install: publicProcedure.mutation(async () => {
    const { installCloudflared } = await import("./v16/tunnelSetup.js");
    return installCloudflared();
  }),

  /** Run `cloudflared tunnel login` — opens browser. Returns the login URL. */
  login: publicProcedure.mutation(async () => {
    const { startCloudflaredLogin } = await import("./v16/tunnelSetup.js");
    return startCloudflaredLogin();
  }),

  /** Create (or detect existing) named tunnel. */
  createTunnel: publicProcedure
    .input(z.object({ name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, "Letters/digits/dash/underscore only") }))
    .mutation(async ({ input }) => {
      const { createTunnel } = await import("./v16/tunnelSetup.js");
      return createTunnel(input.name);
    }),

  /** Write ~/.cloudflared/config.yml. "locked" = phone-callback paths only. */
  writeConfig: publicProcedure
    .input(
      z.object({
        tunnelId: z.string().min(1),
        hostname: z.string().min(3),
        mode: z.enum(["locked", "open"]).default("locked"),
        localPort: z.number().int().positive().max(65535).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { writeConfig } = await import("./v16/tunnelSetup.js");
      return writeConfig(input);
    }),

  /** Add the Cloudflare DNS CNAME mapping hostname → tunnel. */
  addDnsRoute: publicProcedure
    .input(z.object({ tunnelName: z.string().min(1), hostname: z.string().min(3) }))
    .mutation(async ({ input }) => {
      const { addDnsRoute } = await import("./v16/tunnelSetup.js");
      return addDnsRoute(input.tunnelName, input.hostname);
    }),

  /** Install cloudflared as a Windows service so it auto-starts. */
  installService: publicProcedure.mutation(async () => {
    const { installService } = await import("./v16/tunnelSetup.js");
    return installService();
  }),

  /** Hit the public hostname — does it actually answer? */
  ping: publicProcedure
    .input(z.object({ hostname: z.string().min(3) }))
    .query(async ({ input }) => {
      const { pingTunnel } = await import("./v16/tunnelSetup.js");
      return pingTunnel(input.hostname);
    }),

  /** Persist JARVIS_PUBLIC_URL to .env so phone callbacks use the tunnel. */
  setPublicUrl: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      const { setEnvVar } = await import("./v16/tunnelSetup.js");
      setEnvVar("JARVIS_PUBLIC_URL", input.url);
      // Update process.env in-place so the change takes effect without restart
      process.env.JARVIS_PUBLIC_URL = input.url;
      return { ok: true, url: input.url };
    }),
});

// ── Native Control Router ────────────────────────────────────────────────────
// Keyboard, mouse, and window control via nut-js. Companion to systemControl
// (open apps) and navigator (browser). Every action goes through the
// rate-limit + blocklist + audit-log gates inside nativeControl.ts.
//
// Important: this gives JARVIS direct control over the user's input devices.
// Add NATIVE_BLOCKED_APPS=banking,1password,wallet to .env to keep it out
// of sensitive apps. NATIVE_RATE_LIMIT controls actions/min (default 30).
const nativeControlRouter = router({
  /** List visible window titles — useful for "what's open?" planning. */
  windows: publicProcedure.query(async () => {
    const { listWindowTitles, getActiveWindowTitle } = await import("./nativeControl.js");
    const [titles, active] = await Promise.all([listWindowTitles(), getActiveWindowTitle()]);
    return { titles, active };
  }),

  /** Bring a window to the foreground by title substring match. */
  focusWindow: publicProcedure
    .input(z.object({ titleSubstring: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => {
      const { focusWindow } = await import("./nativeControl.js");
      return focusWindow(input.titleSubstring);
    }),

  /** Type text at the current focus. */
  typeText: publicProcedure
    .input(z.object({ text: z.string().min(1).max(4000) }))
    .mutation(async ({ input }) => {
      const { typeText } = await import("./nativeControl.js");
      return typeText(input.text);
    }),

  /** Press a key combo. Names from nut-js Key enum (e.g. ["LeftControl", "S"]). */
  pressKeys: publicProcedure
    .input(z.object({ keys: z.array(z.string().min(1).max(40)).min(1).max(6) }))
    .mutation(async ({ input }) => {
      const { pressKeys } = await import("./nativeControl.js");
      return pressKeys(input.keys);
    }),

  /** Click at absolute screen coordinates. */
  click: publicProcedure
    .input(
      z.object({
        x: z.number().int().min(0).max(20_000),
        y: z.number().int().min(0).max(20_000),
        button: z.enum(["left", "right", "middle"]).optional(),
        doubleClick: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { clickAt } = await import("./nativeControl.js");
      return clickAt(input);
    }),

  /** Find pixel coordinates of a reference image on screen. */
  findOnScreen: publicProcedure
    .input(z.object({ imagePath: z.string().min(1).max(500) }))
    .query(async ({ input }) => {
      const { findOnScreen } = await import("./nativeControl.js");
      const point = await findOnScreen(input.imagePath);
      return { found: point !== null, point };
    }),

  /** Recent action audit log. */
  audit: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(500).default(50) }).optional())
    .query(async ({ input }) => {
      const { readRecentAudit } = await import("./nativeControl.js");
      return readRecentAudit(input?.limit ?? 50);
    }),
});

// ── Credential Vault Router ──────────────────────────────────────────────────
// Encrypted per-site credentials. Master password is the only thing that ever
// crosses the wire; derived key never leaves credentialVault.ts. We split
// `password` and `oldPassword` from logged input so accidental telemetry
// (or middleware that pretty-prints input) doesn't capture them.
const credentialsRouter = router({
  status: publicProcedure.query(async () => {
    const { getStatus } = await import("./credentialVault.js");
    return getStatus();
  }),

  setup: publicProcedure
    .input(z.object({ password: z.string().min(8).max(512) }))
    .mutation(async ({ input }) => {
      const { setupMasterPassword } = await import("./credentialVault.js");
      // Don't let `input` leak via tRPC error formatters: catch + sanitize.
      try {
        return await setupMasterPassword(input.password);
      } catch (err) {
        return { ok: false, message: String(err).slice(0, 200) };
      }
    }),

  unlock: publicProcedure
    .input(z.object({ password: z.string().min(1).max(512) }))
    .mutation(async ({ input }) => {
      const { unlockVault } = await import("./credentialVault.js");
      try {
        return await unlockVault(input.password);
      } catch (err) {
        return { ok: false, message: String(err).slice(0, 200) };
      }
    }),

  lock: publicProcedure.mutation(async () => {
    const { lockVault } = await import("./credentialVault.js");
    lockVault();
    return { ok: true };
  }),

  changeMasterPassword: publicProcedure
    .input(
      z.object({
        oldPassword: z.string().min(1).max(512),
        newPassword: z.string().min(8).max(512),
      })
    )
    .mutation(async ({ input }) => {
      const { changeMasterPassword } = await import("./credentialVault.js");
      try {
        return await changeMasterPassword(input.oldPassword, input.newPassword);
      } catch (err) {
        return { ok: false, message: String(err).slice(0, 200) };
      }
    }),

  list: publicProcedure.query(async () => {
    const { listCredentials } = await import("./credentialVault.js");
    return listCredentials();
  }),

  get: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        name: z.string().min(1).max(200).optional(),
        reason: z.string().min(1).max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { getCredential } = await import("./credentialVault.js");
      try {
        const rec = await getCredential(
          { id: input.id, name: input.name },
          { reason: input.reason ?? "ui" },
        );
        return { ok: true as const, credential: rec };
      } catch (err) {
        return { ok: false as const, message: String(err).slice(0, 200) };
      }
    }),

  add: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        url: z.string().max(2000).optional(),
        tags: z.array(z.string().max(80)).max(20).optional(),
        fields: z.object({
          username: z.string().max(500).optional(),
          password: z.string().max(2000).optional(),
          totpSecret: z.string().max(500).optional(),
          notes: z.string().max(4000).optional(),
          extra: z.record(z.string(), z.string().max(1000)).optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const { addCredential } = await import("./credentialVault.js");
      try {
        return { ok: true as const, credential: await addCredential(input) };
      } catch (err) {
        return { ok: false as const, message: String(err).slice(0, 200) };
      }
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(200).optional(),
        url: z.string().max(2000).nullable().optional(),
        tags: z.array(z.string().max(80)).max(20).optional(),
        fields: z
          .object({
            username: z.string().max(500).optional(),
            password: z.string().max(2000).optional(),
            totpSecret: z.string().max(500).optional(),
            notes: z.string().max(4000).optional(),
            extra: z.record(z.string(), z.string().max(1000)).optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { updateCredential } = await import("./credentialVault.js");
      try {
        return { ok: true as const, credential: await updateCredential(input) };
      } catch (err) {
        return { ok: false as const, message: String(err).slice(0, 200) };
      }
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { deleteCredential } = await import("./credentialVault.js");
      try {
        return await deleteCredential(input.id);
      } catch (err) {
        return { ok: false, message: String(err).slice(0, 200) };
      }
    }),

  audit: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const { readAudit } = await import("./credentialVault.js");
      return readAudit(input?.limit ?? 100);
    }),
});

// ── App Router ────────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  chat: chatRouter,
  knowledge: knowledgeRouter,
  scraper: scraperRouter,
  media: mediaRouter,
  selfImprovement: selfImprovementRouter,
  systemStatus: systemStatusRouter,
  training: trainingRouter,
  voice: voiceRouter,
  memory: memoryRouter,
  llm: llmRouter,
  image: imageRouter,
  video: videoRouter,
  stock: stockRouter,
  trading: tradingRouter,
  integrity: integrityRouter,
  unknownScheduler: unknownSchedulerRouter,
  opinions: opinionsRouter,
  phoneNotify: phoneNotifyRouter,
  distillation: distillationRouter,
  pdfWatcher: pdfWatcherRouter,
  githubRepo: githubRepoRouter,
  selfQuiz: selfQuizRouter,
  book: bookRouter,
  code: codeRouter,
  search: searchRouter,
  settings: settingsRouter,
  multiAgent: multiAgentRouter,
  writingProfile: writingProfileRouter,
  navigator: navigatorRouter,
  systemControl: systemControlRouter,
  scheduler: schedulerRouter,
  webhook: webhookRouter,
  csv: csvRouter,
  videoEdit: videoEditRouter,
  notify: notifyRouter,
  dataFeed: dataFeedRouter,
  planner: plannerRouter,
  reflection: reflectionRouter,
  goals: goalRouter,
  learning: activeLearningRouter,
  meta: metaRouter,
  lora: loraRouter,
  notes: noteEnrichmentRouter,
  benchmarks: benchmarksRouter,
  tunnel: tunnelRouter,
  nativeControl: nativeControlRouter,
  credentials: credentialsRouter,
});

export type AppRouter = typeof appRouter;
