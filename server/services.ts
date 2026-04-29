/**
 * Background services initializer.
 * Called once at server startup to kick off all scheduled background tasks.
 */
import { startMemoryConsolidation } from "./persistentMemory.js";
import { initializeDefaultSettings, getSetting } from "./llmSettings.js";
import { startVoiceLearning } from "./voicelearning.js";
import { startScraperScheduler, scrapeAllSources, initializeDeduplicationCache, setScraperEnabled, startDedupCachePersistence } from "./scraper";
import { setMediaEnabled, startMediaScheduler } from "./mediaIngest.js";
import { logger } from "./logger";
import {
  addScrapeSource,
  getScrapeSources,
} from "./db";
import { startSourceDiscoveryScheduler } from "./sourceDiscovery.js";
import {
  startAutoTraining,
} from "./autoTrain.js";
import { backfillEntityGraph, loadGraph, scanForOrphanEntities } from "./entityExtractor.js";
import { analyzeKnowledge } from "./knowledgeAnalysis.js";
import { startScheduler } from "./scheduler.js";
import { startIntegrityChecker } from "./integrityChecker.js";
import { startUnknownScheduler } from "./unknownScheduler.js";
import { startPdfWatcher } from "./pdfWatcher.js";
import { startGithubRepoScraper } from "./githubRepoScraper.js";
import { startSelfQuiz } from "./selfQuiz.js";
import { startAutonomousLoop } from "./autonomousLoop.js";
import { enableKeepAwake, startLaptopMonitor } from "./keepAwake.js";
import { checkGoalDeadlines } from "./goalManager.js";
import { sendNotification, notify, isConfigured as isNotifyConfigured } from "./phoneNotify.js";
import { notifyGoalDeadline } from "./phoneNotifyHelpers.js";

// Default sources to seed on first run — focused on research, science, and programming knowledge.
// Mix of RSS feeds (auto-polled) and custom_url pages (scraped once, links harvested).
const DEFAULT_SOURCES: Array<{
  name: string;
  url: string;
  type: "rss" | "custom_url";
  intervalMinutes: number;
}> = [
  // ── Research papers & academic ────────────────────────────────────────────
  { name: "ArXiv AI",                 url: "https://arxiv.org/rss/cs.AI",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Machine Learning",   url: "https://arxiv.org/rss/cs.LG",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Computation/Lang",   url: "https://arxiv.org/rss/cs.CL",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Computer Vision",    url: "https://arxiv.org/rss/cs.CV",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Neural Computing",   url: "https://arxiv.org/rss/cs.NE",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Software Eng",       url: "https://arxiv.org/rss/cs.SE",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Programming Lang",   url: "https://arxiv.org/rss/cs.PL",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Distributed Sys",    url: "https://arxiv.org/rss/cs.DC",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Cryptography",       url: "https://arxiv.org/rss/cs.CR",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Robotics",           url: "https://arxiv.org/rss/cs.RO",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "Papers With Code",         url: "https://paperswithcode.com/latest.xml",       type: "rss" as const, intervalMinutes: 60 },
  { name: "Nature",                   url: "https://www.nature.com/nature.rss",           type: "rss" as const, intervalMinutes: 60 },
  { name: "Nature Machine Intel",     url: "https://www.nature.com/natmachintell.rss",    type: "rss" as const, intervalMinutes: 60 },
  { name: "Science Magazine",         url: "https://www.science.org/rss/news_current.xml",type: "rss" as const, intervalMinutes: 60 },
  { name: "PLOS One",                 url: "https://journals.plos.org/plosone/feed/atom", type: "rss" as const, intervalMinutes: 120 },
  { name: "MIT News",                 url: "https://news.mit.edu/rss/research",           type: "rss" as const, intervalMinutes: 60 },
  { name: "Stanford AI Lab",          url: "https://ai.stanford.edu/blog/feed.xml",       type: "rss" as const, intervalMinutes: 120 },
  { name: "Berkeley AI Research",     url: "https://bair.berkeley.edu/blog/feed.xml",     type: "rss" as const, intervalMinutes: 120 },

  // ── AI labs & research blogs ──────────────────────────────────────────────
  { name: "OpenAI Research",          url: "https://openai.com/research/rss.xml",         type: "rss" as const, intervalMinutes: 60 },
  { name: "DeepMind",                 url: "https://www.deepmind.com/blog/rss.xml",       type: "rss" as const, intervalMinutes: 60 },
  { name: "Anthropic News",           url: "https://www.anthropic.com/news/rss.xml",      type: "rss" as const, intervalMinutes: 60 },
  { name: "Google AI Blog",           url: "https://blog.research.google/feeds/posts/default", type: "rss" as const, intervalMinutes: 60 },
  { name: "Meta AI Research",         url: "https://ai.meta.com/blog/rss/",               type: "rss" as const, intervalMinutes: 60 },
  { name: "Hugging Face Blog",        url: "https://huggingface.co/blog/feed.xml",        type: "rss" as const, intervalMinutes: 60 },
  { name: "Distill",                  url: "https://distill.pub/rss.xml",                 type: "rss" as const, intervalMinutes: 240 },

  // ── Programming & software engineering ────────────────────────────────────
  { name: "Hacker News (Best)",       url: "https://hnrss.org/best",                      type: "rss" as const, intervalMinutes: 30 },
  { name: "Hacker News (Show HN)",    url: "https://hnrss.org/show",                      type: "rss" as const, intervalMinutes: 30 },
  { name: "GitHub Blog",              url: "https://github.blog/feed/",                   type: "rss" as const, intervalMinutes: 60 },
  { name: "GitHub Trending TS",       url: "https://github.com/trending/typescript.rss",  type: "rss" as const, intervalMinutes: 60 },
  { name: "GitHub Trending Python",   url: "https://github.com/trending/python.rss",      type: "rss" as const, intervalMinutes: 60 },
  { name: "GitHub Trending Rust",     url: "https://github.com/trending/rust.rss",        type: "rss" as const, intervalMinutes: 60 },
  { name: "GitHub Trending Go",       url: "https://github.com/trending/go.rss",          type: "rss" as const, intervalMinutes: 60 },
  { name: "Dev.to",                   url: "https://dev.to/feed",                         type: "rss" as const, intervalMinutes: 30 },
  { name: "Stack Overflow Blog",      url: "https://stackoverflow.blog/feed/",            type: "rss" as const, intervalMinutes: 60 },
  { name: "Martin Fowler",            url: "https://martinfowler.com/feed.atom",          type: "rss" as const, intervalMinutes: 240 },
  { name: "High Scalability",         url: "https://highscalability.com/rss.xml",         type: "rss" as const, intervalMinutes: 240 },
  { name: "InfoQ",                    url: "https://feed.infoq.com/",                     type: "rss" as const, intervalMinutes: 60 },
  { name: "The Pragmatic Engineer",   url: "https://blog.pragmaticengineer.com/rss/",     type: "rss" as const, intervalMinutes: 240 },

  // ── Language & framework docs/blogs ───────────────────────────────────────
  { name: "TypeScript Blog",          url: "https://devblogs.microsoft.com/typescript/feed/", type: "rss" as const, intervalMinutes: 240 },
  { name: "Node.js Blog",             url: "https://nodejs.org/en/feed/blog.xml",         type: "rss" as const, intervalMinutes: 240 },
  { name: "Python Insider",           url: "https://blog.python.org/feeds/posts/default", type: "rss" as const, intervalMinutes: 240 },
  { name: "Rust Blog",                url: "https://blog.rust-lang.org/feed.xml",         type: "rss" as const, intervalMinutes: 240 },
  { name: "Go Blog",                  url: "https://go.dev/blog/feed.atom",               type: "rss" as const, intervalMinutes: 240 },
  { name: "React Blog",               url: "https://react.dev/rss.xml",                   type: "rss" as const, intervalMinutes: 240 },
  { name: "MDN Web Docs",             url: "https://developer.mozilla.org/en-US/blog/rss.xml", type: "rss" as const, intervalMinutes: 240 },

  // ── Engineering blogs (real-world systems) ────────────────────────────────
  { name: "Netflix Tech Blog",        url: "https://netflixtechblog.com/feed",            type: "rss" as const, intervalMinutes: 240 },
  { name: "Uber Engineering",         url: "https://www.uber.com/blog/engineering/rss/",  type: "rss" as const, intervalMinutes: 240 },
  { name: "Cloudflare Blog",          url: "https://blog.cloudflare.com/rss/",            type: "rss" as const, intervalMinutes: 240 },
  { name: "Stripe Engineering",       url: "https://stripe.com/blog/feed.rss",            type: "rss" as const, intervalMinutes: 240 },

  // ── Science & general knowledge ───────────────────────────────────────────
  { name: "Science Daily",            url: "https://www.sciencedaily.com/rss/all.xml",    type: "rss" as const, intervalMinutes: 60 },
  { name: "MIT Technology Review",    url: "https://www.technologyreview.com/feed/",      type: "rss" as const, intervalMinutes: 60 },
  { name: "Quanta Magazine",          url: "https://www.quantamagazine.org/feed/",        type: "rss" as const, intervalMinutes: 240 },
  { name: "Ars Technica Science",     url: "https://feeds.arstechnica.com/arstechnica/science", type: "rss" as const, intervalMinutes: 60 },
  { name: "Wikipedia Featured",       url: "https://en.wikipedia.org/w/api.php?action=featuredfeed&feed=featured&feedformat=rss", type: "rss" as const, intervalMinutes: 720 },

  // ── Law & case law ────────────────────────────────────────────────────────
  { name: "SCOTUSblog",                   url: "https://www.scotusblog.com/feed/",               type: "rss" as const, intervalMinutes: 60 },
  { name: "Lawfare Blog",                url: "https://www.lawfaremedia.org/feed",               type: "rss" as const, intervalMinutes: 60 },
  { name: "ABA Journal",                 url: "https://www.abajournal.com/feed",                 type: "rss" as const, intervalMinutes: 120 },
  { name: "Harvard Law Review Blog",     url: "https://blog.harvardlawreview.org/feed/",         type: "rss" as const, intervalMinutes: 240 },
  { name: "Yale Law Journal — Forum",    url: "https://www.yalelawjournal.org/forum.rss",        type: "rss" as const, intervalMinutes: 240 },
  { name: "Volokh Conspiracy (Reason)",  url: "https://reason.com/volokh/feed/",                 type: "rss" as const, intervalMinutes: 120 },
  { name: "Jurist — Legal News",         url: "https://www.jurist.org/news/feed/",               type: "rss" as const, intervalMinutes: 60 },
  { name: "Cornell LII — Recent",        url: "https://www.law.cornell.edu/rss/mostrecent.rss",  type: "rss" as const, intervalMinutes: 120 },
  { name: "Oyez — Supreme Court",        url: "https://www.oyez.org",                            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Cornell LII — Constitution",  url: "https://www.law.cornell.edu/constitution",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Justia — US Supreme Court",   url: "https://supreme.justia.com",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "FindLaw — Caselaw",           url: "https://caselaw.findlaw.com",                     type: "custom_url" as const, intervalMinutes: 10080 },

  // ── History ───────────────────────────────────────────────────────────────
  { name: "History Today",                url: "https://www.historytoday.com/feed/rss.xml",       type: "rss" as const, intervalMinutes: 120 },
  { name: "Smithsonian History",          url: "https://www.smithsonianmag.com/rss/history/",     type: "rss" as const, intervalMinutes: 120 },
  { name: "World History Encyclopedia",   url: "https://www.worldhistory.org/feed/",              type: "rss" as const, intervalMinutes: 240 },
  { name: "National Archives Blog",       url: "https://prologue.blogs.archives.gov/feed/",       type: "rss" as const, intervalMinutes: 240 },
  { name: "British Museum Blog",          url: "https://www.britishmuseum.org/blog/rss.xml",      type: "rss" as const, intervalMinutes: 240 },
  { name: "History.com",                  url: "https://www.history.com",                         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Britannica — World History",   url: "https://www.britannica.com/topic/history",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Khan Academy — World History", url: "https://www.khanacademy.org/humanities/world-history", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "National WWII Museum",         url: "https://www.nationalww2museum.org",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "US Holocaust Memorial Museum", url: "https://www.ushmm.org",                           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Library of Congress — Primary Sources", url: "https://www.loc.gov/collections/",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Ancient History Encyclopedia", url: "https://www.worldhistory.org/ancient/",           type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Hitler — historical leadership analysis ───────────────────────────────
  { name: "Wikipedia — Adolf Hitler",                url: "https://en.wikipedia.org/wiki/Adolf_Hitler",                              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Rise of Nazi Germany",        url: "https://en.wikipedia.org/wiki/Nazi_Germany",                              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Hitler's Rise to Power",      url: "https://en.wikipedia.org/wiki/Adolf_Hitler%27s_rise_to_power",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Beer Hall Putsch",            url: "https://en.wikipedia.org/wiki/Beer_Hall_Putsch",                          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Enabling Act 1933",           url: "https://en.wikipedia.org/wiki/Enabling_Act_of_1933",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Nazi Propaganda",             url: "https://en.wikipedia.org/wiki/Propaganda_in_Nazi_Germany",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Hitler Military Leadership",  url: "https://en.wikipedia.org/wiki/Adolf_Hitler%27s_leadership_style",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — German Economy Under Nazis",  url: "https://en.wikipedia.org/wiki/Economy_of_Nazi_Germany",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Autobahn History",            url: "https://en.wikipedia.org/wiki/Reichsautobahn",                            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Weimar Republic",             url: "https://en.wikipedia.org/wiki/Weimar_Republic",                           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Treaty of Versailles",        url: "https://en.wikipedia.org/wiki/Treaty_of_Versailles",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — The Holocaust",               url: "https://en.wikipedia.org/wiki/The_Holocaust",                             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Nuremberg Rallies",           url: "https://en.wikipedia.org/wiki/Nuremberg_rallies",                         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Hitler Youth",                url: "https://en.wikipedia.org/wiki/Hitler_Youth",                              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Mein Kampf",                  url: "https://en.wikipedia.org/wiki/Mein_Kampf",                                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Operation Barbarossa",        url: "https://en.wikipedia.org/wiki/Operation_Barbarossa",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Battle of Stalingrad",        url: "https://en.wikipedia.org/wiki/Battle_of_Stalingrad",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Fall of Berlin",              url: "https://en.wikipedia.org/wiki/Battle_of_Berlin",                           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Britannica — Adolf Hitler",               url: "https://www.britannica.com/biography/Adolf-Hitler",                       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Holocaust Encyclopedia — Hitler",         url: "https://encyclopedia.ushmm.org/content/en/article/adolf-hitler-early-years", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "National WWII Museum — Hitler Rise",      url: "https://www.nationalww2museum.org/war/topics/adolf-hitler",               type: "custom_url" as const, intervalMinutes: 10080 },

  // ── User-added research pages (custom_url: scraped once, links harvested) ─
  { name: "Reddit — CMV Hitler thread",        url: "https://www.reddit.com/r/changemyview/comments/3pinwx/cmv_hitler_was_a_great_leader/", type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "FBI Vault — Nikola Tesla",          url: "https://vault.fbi.gov/nikola-tesla",                                                    type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "Britannica — Nikola Tesla",         url: "https://www.britannica.com/biography/Nikola-Tesla",                                     type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "Google Scholar — abortion",         url: "https://scholar.google.com/scholar?hl=en&as_sdt=4006&q=abortion&btnG=",                 type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "Google Scholar — AI",               url: "https://scholar.google.com/scholar?hl=en&as_sdt=0%2C6&q=Ai&btnG=",                      type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "Simply Psychology — Freud",         url: "https://www.simplypsychology.org/sigmund-freud.html",                                   type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "Sweller 1988 — Cognitive Load PDF", url: "https://andymatuschak.org/files/papers/Sweller%20-%201988%20-%20Cognitive%20load%20during%20problem%20solving.pdf", type: "custom_url" as const, intervalMinutes: 10080 },

  // ── W3Schools tutorials (scraped once, sitemap probe harvests the rest) ──
  // One landing page per topic; the sitemap probe on first scrape will
  // enqueue the full w3schools.com sitemap into the crawl frontier, so
  // all individual tutorial pages get pulled in automatically.
  { name: "W3Schools — Python",          url: "https://www.w3schools.com/python/",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — JavaScript",      url: "https://www.w3schools.com/js/default.asp",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — HTML",            url: "https://www.w3schools.com/html/default.asp",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — CSS",             url: "https://www.w3schools.com/css/default.asp",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — Java",            url: "https://www.w3schools.com/java/default.asp",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — How To",          url: "https://www.w3schools.com/howto/default.asp",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — React",           url: "https://www.w3schools.com/react/default.asp",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — Node.js",         url: "https://www.w3schools.com/nodejs/default.asp",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — Git",             url: "https://www.w3schools.com/git/default.asp",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — AI",              url: "https://www.w3schools.com/ai/default.asp",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — Generative AI",   url: "https://www.w3schools.com/gen_ai/index.php",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — Cybersecurity",   url: "https://www.w3schools.com/cybersecurity/index.php", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — Data Science",    url: "https://www.w3schools.com/datascience/default.asp", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "W3Schools — Programming",     url: "https://www.w3schools.com/programming/index.php",   type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Engineering — research papers, standards, and educational sources ─────
  // Covers civil, mechanical, electrical, thermal, aerospace, astronautical,
  // chemical, materials, biomedical, nuclear, environmental, and software eng.

  // ArXiv physics/engineering RSS feeds (auto-polled)
  { name: "ArXiv — Electrical Eng/Systems Sci", url: "https://arxiv.org/rss/eess",        type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv — Signal Processing",          url: "https://arxiv.org/rss/eess.SP",     type: "rss" as const, intervalMinutes: 120 },
  { name: "ArXiv — Systems and Control",        url: "https://arxiv.org/rss/eess.SY",     type: "rss" as const, intervalMinutes: 120 },
  { name: "ArXiv — Image and Video Processing", url: "https://arxiv.org/rss/eess.IV",     type: "rss" as const, intervalMinutes: 120 },
  { name: "ArXiv — Applied Physics",            url: "https://arxiv.org/rss/physics.app-ph", type: "rss" as const, intervalMinutes: 120 },
  { name: "ArXiv — Fluid Dynamics",             url: "https://arxiv.org/rss/physics.flu-dyn", type: "rss" as const, intervalMinutes: 120 },
  { name: "ArXiv — Space Physics",              url: "https://arxiv.org/rss/physics.space-ph", type: "rss" as const, intervalMinutes: 120 },
  { name: "ArXiv — Instrumentation & Detectors", url: "https://arxiv.org/rss/physics.ins-det", type: "rss" as const, intervalMinutes: 240 },
  { name: "ArXiv — Plasma Physics",             url: "https://arxiv.org/rss/physics.plasm-ph", type: "rss" as const, intervalMinutes: 240 },
  { name: "ArXiv — Atmospheric & Oceanic",      url: "https://arxiv.org/rss/physics.ao-ph", type: "rss" as const, intervalMinutes: 240 },

  // Engineering news and analysis feeds
  { name: "IEEE Spectrum",                       url: "https://spectrum.ieee.org/feeds/feed.rss",                 type: "rss" as const, intervalMinutes: 60 },
  { name: "IEEE Spectrum — Aerospace",           url: "https://spectrum.ieee.org/rss/aerospace",                  type: "rss" as const, intervalMinutes: 120 },
  { name: "IEEE Spectrum — Energy",              url: "https://spectrum.ieee.org/rss/energy",                     type: "rss" as const, intervalMinutes: 120 },
  { name: "IEEE Spectrum — Transportation",      url: "https://spectrum.ieee.org/rss/transportation",             type: "rss" as const, intervalMinutes: 120 },
  { name: "IEEE Spectrum — Semiconductors",      url: "https://spectrum.ieee.org/rss/semiconductors",             type: "rss" as const, intervalMinutes: 120 },
  { name: "IEEE Spectrum — Robotics",            url: "https://spectrum.ieee.org/rss/robotics",                   type: "rss" as const, intervalMinutes: 120 },
  { name: "NASA Spaceflight",                    url: "https://www.nasaspaceflight.com/feed/",                    type: "rss" as const, intervalMinutes: 120 },
  { name: "NASA Breaking News",                  url: "https://www.nasa.gov/news-release/feed/",                  type: "rss" as const, intervalMinutes: 60 },
  { name: "SpaceNews",                           url: "https://spacenews.com/feed/",                              type: "rss" as const, intervalMinutes: 120 },
  { name: "Aviation Week",                       url: "https://aviationweek.com/rss",                             type: "rss" as const, intervalMinutes: 180 },
  { name: "Engineering.com",                     url: "https://www.engineering.com/rss/index.xml",                type: "rss" as const, intervalMinutes: 180 },
  { name: "MIT News — Engineering",              url: "https://news.mit.edu/rss/topic/engineering",               type: "rss" as const, intervalMinutes: 120 },
  { name: "Stanford Engineering News",           url: "https://engineering.stanford.edu/news/feed",               type: "rss" as const, intervalMinutes: 240 },
  { name: "New Atlas",                           url: "https://newatlas.com/feed/",                               type: "rss" as const, intervalMinutes: 180 },
  { name: "The Engineer (UK)",                   url: "https://www.theengineer.co.uk/feed/",                      type: "rss" as const, intervalMinutes: 180 },

  // ── Civil Engineering ──
  { name: "Wikipedia — Civil Engineering",       url: "https://en.wikipedia.org/wiki/Civil_engineering",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Structural Engineering",  url: "https://en.wikipedia.org/wiki/Structural_engineering",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Geotechnical Engineering", url: "https://en.wikipedia.org/wiki/Geotechnical_engineering",  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Transportation Engineering", url: "https://en.wikipedia.org/wiki/Transportation_engineering", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Hydraulic Engineering",   url: "https://en.wikipedia.org/wiki/Hydraulic_engineering",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Earthquake Engineering",  url: "https://en.wikipedia.org/wiki/Earthquake_engineering",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Britannica — Civil Engineering",      url: "https://www.britannica.com/technology/civil-engineering",  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "ASCE News",                           url: "https://www.asce.org/publications-and-news/civil-engineering-news", type: "custom_url" as const, intervalMinutes: 1440 },

  // ── Mechanical Engineering ──
  { name: "Wikipedia — Mechanical Engineering",  url: "https://en.wikipedia.org/wiki/Mechanical_engineering",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Statics",                 url: "https://en.wikipedia.org/wiki/Statics",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Dynamics (mechanics)",    url: "https://en.wikipedia.org/wiki/Dynamics_(mechanics)",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Strength of Materials",   url: "https://en.wikipedia.org/wiki/Strength_of_materials",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Machine Design",          url: "https://en.wikipedia.org/wiki/Machine",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Mechatronics",            url: "https://en.wikipedia.org/wiki/Mechatronics",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Manufacturing Engineering", url: "https://en.wikipedia.org/wiki/Manufacturing_engineering", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Robotics",                url: "https://en.wikipedia.org/wiki/Robotics",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "ASME Engineering Topics",             url: "https://www.asme.org/topics-resources",                    type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "MIT OCW — Mechanical Engineering",    url: "https://ocw.mit.edu/courses/mechanical-engineering/",      type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Electrical Engineering ──
  { name: "Wikipedia — Electrical Engineering",  url: "https://en.wikipedia.org/wiki/Electrical_engineering",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Electronic Engineering",  url: "https://en.wikipedia.org/wiki/Electronic_engineering",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Power Engineering",       url: "https://en.wikipedia.org/wiki/Power_engineering",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Circuit Design",          url: "https://en.wikipedia.org/wiki/Circuit_design",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Control Systems",         url: "https://en.wikipedia.org/wiki/Control_system",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Digital Signal Processing", url: "https://en.wikipedia.org/wiki/Digital_signal_processing", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — VLSI",                    url: "https://en.wikipedia.org/wiki/Very-large-scale_integration", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "All About Circuits",                  url: "https://www.allaboutcircuits.com",                         type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "Electronics Tutorials",               url: "https://www.electronics-tutorials.ws",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "MIT OCW — Electrical Engineering",    url: "https://ocw.mit.edu/courses/electrical-engineering-and-computer-science/", type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Thermal / Thermodynamics ──
  { name: "Wikipedia — Thermodynamics",          url: "https://en.wikipedia.org/wiki/Thermodynamics",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Heat Transfer",           url: "https://en.wikipedia.org/wiki/Heat_transfer",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Fluid Mechanics",         url: "https://en.wikipedia.org/wiki/Fluid_mechanics",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — HVAC",                    url: "https://en.wikipedia.org/wiki/Heating,_ventilation,_and_air_conditioning", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Refrigeration",           url: "https://en.wikipedia.org/wiki/Refrigeration",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Internal Combustion Engine", url: "https://en.wikipedia.org/wiki/Internal_combustion_engine", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Thermal Engineering",     url: "https://en.wikipedia.org/wiki/Thermal_engineering",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Engineering ToolBox",                 url: "https://www.engineeringtoolbox.com",                       type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Aerospace Engineering ──
  { name: "Wikipedia — Aerospace Engineering",   url: "https://en.wikipedia.org/wiki/Aerospace_engineering",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Aerodynamics",            url: "https://en.wikipedia.org/wiki/Aerodynamics",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Aircraft Design",         url: "https://en.wikipedia.org/wiki/Aircraft_design_process",    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Jet Engine",              url: "https://en.wikipedia.org/wiki/Jet_engine",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Propulsion",              url: "https://en.wikipedia.org/wiki/Propulsion",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Flight Dynamics",         url: "https://en.wikipedia.org/wiki/Flight_dynamics",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "NASA Technical Reports Server",       url: "https://ntrs.nasa.gov",                                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "AIAA Publications",                   url: "https://www.aiaa.org/publications",                        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "MIT OCW — Aeronautics and Astronautics", url: "https://ocw.mit.edu/courses/aeronautics-and-astronautics/", type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Astronautical Engineering / Space ──
  { name: "Wikipedia — Astronautics",            url: "https://en.wikipedia.org/wiki/Astronautics",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Orbital Mechanics",       url: "https://en.wikipedia.org/wiki/Orbital_mechanics",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Spacecraft Design",       url: "https://en.wikipedia.org/wiki/Spacecraft_design",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Rocket Engine",           url: "https://en.wikipedia.org/wiki/Rocket_engine",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Spacecraft Propulsion",   url: "https://en.wikipedia.org/wiki/Spacecraft_propulsion",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Satellite",               url: "https://en.wikipedia.org/wiki/Satellite",                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Life Support System",     url: "https://en.wikipedia.org/wiki/Life_support_system",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "NASA — Space Technology",             url: "https://www.nasa.gov/space-technology/",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "ESA — Space Engineering",             url: "https://www.esa.int/Enabling_Support/Space_Engineering_Technology", type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Chemical Engineering ──
  { name: "Wikipedia — Chemical Engineering",    url: "https://en.wikipedia.org/wiki/Chemical_engineering",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Process Engineering",     url: "https://en.wikipedia.org/wiki/Process_engineering",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Chemical Reactor",        url: "https://en.wikipedia.org/wiki/Chemical_reactor",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Distillation",            url: "https://en.wikipedia.org/wiki/Distillation",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "AIChE CEP Magazine",                  url: "https://www.aiche.org/resources/publications/cep",         type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Materials Engineering ──
  { name: "Wikipedia — Materials Science",       url: "https://en.wikipedia.org/wiki/Materials_science",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Metallurgy",              url: "https://en.wikipedia.org/wiki/Metallurgy",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Composite Materials",     url: "https://en.wikipedia.org/wiki/Composite_material",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Nanomaterials",           url: "https://en.wikipedia.org/wiki/Nanomaterials",              type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Nuclear Engineering ──
  { name: "Wikipedia — Nuclear Engineering",     url: "https://en.wikipedia.org/wiki/Nuclear_engineering",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Nuclear Reactor",         url: "https://en.wikipedia.org/wiki/Nuclear_reactor",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Fusion Power",            url: "https://en.wikipedia.org/wiki/Fusion_power",               type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Biomedical Engineering ──
  { name: "Wikipedia — Biomedical Engineering",  url: "https://en.wikipedia.org/wiki/Biomedical_engineering",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Medical Device",          url: "https://en.wikipedia.org/wiki/Medical_device",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Biomechanics",            url: "https://en.wikipedia.org/wiki/Biomechanics",               type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Environmental Engineering ──
  { name: "Wikipedia — Environmental Engineering", url: "https://en.wikipedia.org/wiki/Environmental_engineering", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Water Treatment",         url: "https://en.wikipedia.org/wiki/Water_treatment",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Waste Management",        url: "https://en.wikipedia.org/wiki/Waste_management",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Renewable Energy",        url: "https://en.wikipedia.org/wiki/Renewable_energy",           type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Software / Systems Engineering ──
  { name: "Wikipedia — Software Engineering",    url: "https://en.wikipedia.org/wiki/Software_engineering",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Systems Engineering",     url: "https://en.wikipedia.org/wiki/Systems_engineering",        type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Engineering reference hubs (sitemap crawl will harvest from these) ──
  { name: "Engineering Library — LibreTexts",    url: "https://eng.libretexts.org",                               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Physics LibreTexts",                  url: "https://phys.libretexts.org",                              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "HyperPhysics",                        url: "http://hyperphysics.phy-astr.gsu.edu/hbase/hph.html",      type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Catholicism — theology, history, apologetics, liturgy, saints, tradition ─
  // Mix of official Vatican/USCCB, encyclopedia references, apologetics, and
  // Catholic news/media. Covers Catechism, Scripture, Church Fathers, saints,
  // liturgy, sacraments, moral theology, and Catholic history.

  // Official Church sources
  { name: "Vatican — The Holy See",              url: "https://www.vatican.va/content/vatican/en.html",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Vatican News",                         url: "https://www.vaticannews.va/en.rss.xml",                    type: "rss" as const, intervalMinutes: 120 },
  { name: "USCCB — US Catholic Bishops",         url: "https://www.usccb.org",                                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Catechism of the Catholic Church",    url: "https://www.vatican.va/archive/ENG0015/_INDEX.HTM",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Compendium of the Catechism",         url: "https://www.vatican.va/archive/compendium_ccc/documents/archive_2005_compendium-ccc_en.html", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "USCCB — Daily Readings",              url: "https://bible.usccb.org/daily-bible-reading",              type: "custom_url" as const, intervalMinutes: 1440 },

  // Scripture
  { name: "USCCB — NAB Bible",                   url: "https://bible.usccb.org/bible",                            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Biblia — Douay-Rheims",               url: "https://www.biblia.com/books/drb/",                        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bible",                   url: "https://en.wikipedia.org/wiki/Bible",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Deuterocanonical Books",  url: "https://en.wikipedia.org/wiki/Deuterocanonical_books",     type: "custom_url" as const, intervalMinutes: 10080 },

  // Theology / Catechesis
  { name: "Wikipedia — Catholic Church",         url: "https://en.wikipedia.org/wiki/Catholic_Church",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Catholic Theology",       url: "https://en.wikipedia.org/wiki/Catholic_theology",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Dogma",                   url: "https://en.wikipedia.org/wiki/Dogma_in_the_Catholic_Church", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Holy Trinity",            url: "https://en.wikipedia.org/wiki/Trinity",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Incarnation",             url: "https://en.wikipedia.org/wiki/Incarnation_(Christianity)", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Eucharist",               url: "https://en.wikipedia.org/wiki/Eucharist_in_the_Catholic_Church", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Transubstantiation",      url: "https://en.wikipedia.org/wiki/Transubstantiation",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Mariology",               url: "https://en.wikipedia.org/wiki/Mariology_of_the_Catholic_Church", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Immaculate Conception",   url: "https://en.wikipedia.org/wiki/Immaculate_Conception",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Assumption of Mary",      url: "https://en.wikipedia.org/wiki/Assumption_of_Mary",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Papal Infallibility",     url: "https://en.wikipedia.org/wiki/Papal_infallibility",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Apostolic Succession",    url: "https://en.wikipedia.org/wiki/Apostolic_succession",       type: "custom_url" as const, intervalMinutes: 10080 },

  // Sacraments & Liturgy
  { name: "Wikipedia — Seven Sacraments",        url: "https://en.wikipedia.org/wiki/Sacraments_of_the_Catholic_Church", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Baptism",                 url: "https://en.wikipedia.org/wiki/Baptism",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Confirmation",            url: "https://en.wikipedia.org/wiki/Confirmation_in_the_Catholic_Church", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Reconciliation/Confession", url: "https://en.wikipedia.org/wiki/Sacrament_of_Penance",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Holy Orders",             url: "https://en.wikipedia.org/wiki/Holy_orders_in_the_Catholic_Church", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Matrimony",               url: "https://en.wikipedia.org/wiki/Marriage_in_the_Catholic_Church", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Anointing of the Sick",   url: "https://en.wikipedia.org/wiki/Anointing_of_the_sick",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Mass (liturgy)",          url: "https://en.wikipedia.org/wiki/Mass_(liturgy)",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Latin Mass",              url: "https://en.wikipedia.org/wiki/Tridentine_Mass",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Liturgy of the Hours",    url: "https://en.wikipedia.org/wiki/Liturgy_of_the_Hours",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Liturgical Year",         url: "https://en.wikipedia.org/wiki/Liturgical_year",            type: "custom_url" as const, intervalMinutes: 10080 },

  // Church Fathers & Doctors
  { name: "Wikipedia — Church Fathers",          url: "https://en.wikipedia.org/wiki/Church_Fathers",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Doctors of the Church",   url: "https://en.wikipedia.org/wiki/Doctor_of_the_Church",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Augustine of Hippo",      url: "https://en.wikipedia.org/wiki/Augustine_of_Hippo",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Thomas Aquinas",          url: "https://en.wikipedia.org/wiki/Thomas_Aquinas",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Jerome",                  url: "https://en.wikipedia.org/wiki/Jerome",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Ambrose",                 url: "https://en.wikipedia.org/wiki/Ambrose",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Gregory the Great",       url: "https://en.wikipedia.org/wiki/Pope_Gregory_I",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — John Chrysostom",         url: "https://en.wikipedia.org/wiki/John_Chrysostom",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "New Advent — Church Fathers",         url: "https://www.newadvent.org/fathers/",                       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "New Advent — Summa Theologica",       url: "https://www.newadvent.org/summa/",                         type: "custom_url" as const, intervalMinutes: 10080 },

  // Saints & Marian apparitions
  { name: "Wikipedia — Catholic Saints",         url: "https://en.wikipedia.org/wiki/Saint",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Canonization",            url: "https://en.wikipedia.org/wiki/Canonization",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Our Lady of Fatima",      url: "https://en.wikipedia.org/wiki/Our_Lady_of_F%C3%A1tima",    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Our Lady of Lourdes",     url: "https://en.wikipedia.org/wiki/Our_Lady_of_Lourdes",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Our Lady of Guadalupe",   url: "https://en.wikipedia.org/wiki/Our_Lady_of_Guadalupe",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — St. Francis of Assisi",   url: "https://en.wikipedia.org/wiki/Francis_of_Assisi",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — St. Teresa of Avila",     url: "https://en.wikipedia.org/wiki/Teresa_of_%C3%81vila",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — St. John Paul II",        url: "https://en.wikipedia.org/wiki/Pope_John_Paul_II",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — St. Mother Teresa",       url: "https://en.wikipedia.org/wiki/Mother_Teresa",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Padre Pio",               url: "https://en.wikipedia.org/wiki/Padre_Pio",                  type: "custom_url" as const, intervalMinutes: 10080 },

  // History of the Catholic Church
  { name: "Wikipedia — History of the Catholic Church", url: "https://en.wikipedia.org/wiki/History_of_the_Catholic_Church", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Early Christianity",      url: "https://en.wikipedia.org/wiki/Early_Christianity",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Council of Nicaea",       url: "https://en.wikipedia.org/wiki/First_Council_of_Nicaea",    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Ecumenical Councils",     url: "https://en.wikipedia.org/wiki/Ecumenical_council",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Second Vatican Council",  url: "https://en.wikipedia.org/wiki/Second_Vatican_Council",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Council of Trent",        url: "https://en.wikipedia.org/wiki/Council_of_Trent",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Protestant Reformation",  url: "https://en.wikipedia.org/wiki/Reformation",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Counter-Reformation",     url: "https://en.wikipedia.org/wiki/Counter-Reformation",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Great Schism",            url: "https://en.wikipedia.org/wiki/East%E2%80%93West_Schism",   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Papal States",            url: "https://en.wikipedia.org/wiki/Papal_States",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Inquisition",             url: "https://en.wikipedia.org/wiki/Inquisition",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Crusades",                url: "https://en.wikipedia.org/wiki/Crusades",                   type: "custom_url" as const, intervalMinutes: 10080 },

  // Moral theology / social teaching
  { name: "Wikipedia — Catholic Social Teaching", url: "https://en.wikipedia.org/wiki/Catholic_social_teaching", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Natural Law",             url: "https://en.wikipedia.org/wiki/Natural_law",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Seven Deadly Sins",       url: "https://en.wikipedia.org/wiki/Seven_deadly_sins",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Seven Virtues",           url: "https://en.wikipedia.org/wiki/Seven_virtues",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Ten Commandments",        url: "https://en.wikipedia.org/wiki/Ten_Commandments",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Beatitudes",              url: "https://en.wikipedia.org/wiki/Beatitudes",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Catholic Moral Theology", url: "https://en.wikipedia.org/wiki/Catholic_moral_theology",    type: "custom_url" as const, intervalMinutes: 10080 },

  // Apologetics & reference
  { name: "Catholic Answers",                     url: "https://www.catholic.com",                                 type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "Catholic Encyclopedia (New Advent)",  url: "https://www.newadvent.org/cathen/",                        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "EWTN — Catholic Library",             url: "https://www.ewtn.com/catholicism/library",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Word on Fire (Bishop Barron)",        url: "https://www.wordonfire.org",                               type: "custom_url" as const, intervalMinutes: 1440 },

  // Catholic news (RSS feeds — auto-polled)
  { name: "Catholic News Agency",                url: "https://www.catholicnewsagency.com/rss/news.xml",          type: "rss" as const, intervalMinutes: 120 },
  { name: "National Catholic Register",          url: "https://www.ncregister.com/rss.xml",                       type: "rss" as const, intervalMinutes: 180 },
  { name: "Crux Now",                             url: "https://cruxnow.com/feed",                                 type: "rss" as const, intervalMinutes: 180 },
  { name: "Aleteia",                              url: "https://aleteia.org/feed/",                                type: "rss" as const, intervalMinutes: 240 },
  { name: "First Things",                         url: "https://www.firstthings.com/rss/all",                      type: "rss" as const, intervalMinutes: 240 },
  { name: "America Magazine (Jesuit)",           url: "https://www.americamagazine.org/feed",                     type: "rss" as const, intervalMinutes: 240 },

  // ── Conspiracy theories / fringe history / unexplained ──────────────────
  // Mix of declassified government archives (primary sources), academic /
  // skeptical analysis, and reporting on modern disclosures. Goal is to give
  // JARVIS both the mainstream evidence AND the claims people actually make
  // so it can reason about either side.
  { name: "JFK Assassination Records (NARA)",    url: "https://www.archives.gov/research/jfk",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Warren Commission Report",             url: "https://www.archives.gov/research/jfk/warren-commission-report", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — JFK Assassination",        url: "https://en.wikipedia.org/wiki/Assassination_of_John_F._Kennedy", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — JFK Conspiracy Theories",  url: "https://en.wikipedia.org/wiki/John_F._Kennedy_assassination_conspiracy_theories", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — RFK Assassination",        url: "https://en.wikipedia.org/wiki/Assassination_of_Robert_F._Kennedy", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — MLK Assassination",        url: "https://en.wikipedia.org/wiki/Assassination_of_Martin_Luther_King_Jr.", type: "custom_url" as const, intervalMinutes: 10080 },
  // UFOs / UAP
  { name: "NASA — UAP Report",                    url: "https://www.nasa.gov/headquarters/library/find/bibliographies/uap/", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Pentagon AARO (UAP office)",           url: "https://www.aaro.mil",                                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — UFO",                      url: "https://en.wikipedia.org/wiki/Unidentified_flying_object",  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — UAP",                      url: "https://en.wikipedia.org/wiki/Unidentified_anomalous_phenomena", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Roswell incident",         url: "https://en.wikipedia.org/wiki/Roswell_incident",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Project Blue Book",        url: "https://en.wikipedia.org/wiki/Project_Blue_Book",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Area 51",                  url: "https://en.wikipedia.org/wiki/Area_51",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Phoenix Lights",           url: "https://en.wikipedia.org/wiki/Phoenix_Lights",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Tic Tac UFO (USS Nimitz)", url: "https://en.wikipedia.org/wiki/USS_Nimitz_UFO_incident",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — David Grusch testimony",   url: "https://en.wikipedia.org/wiki/David_Grusch_UFO_whistleblower_claims", type: "custom_url" as const, intervalMinutes: 10080 },
  // 9/11
  { name: "NIST — WTC Investigation",             url: "https://www.nist.gov/topics/disaster-failure-studies/world-trade-center-investigation", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "9/11 Commission Report (NARA)",        url: "https://www.9-11commission.gov/report/",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — September 11 attacks",     url: "https://en.wikipedia.org/wiki/September_11_attacks",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — 9/11 conspiracy theories", url: "https://en.wikipedia.org/wiki/9/11_conspiracy_theories",    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — WTC 7 collapse",           url: "https://en.wikipedia.org/wiki/Collapse_of_7_World_Trade_Center", type: "custom_url" as const, intervalMinutes: 10080 },
  // MK-Ultra / CIA programs
  { name: "CIA FOIA Reading Room",                url: "https://www.cia.gov/readingroom/",                          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — MK-Ultra",                 url: "https://en.wikipedia.org/wiki/MKUltra",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Church Committee",         url: "https://en.wikipedia.org/wiki/Church_Committee",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Operation Mockingbird",    url: "https://en.wikipedia.org/wiki/Operation_Mockingbird",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Operation Paperclip",      url: "https://en.wikipedia.org/wiki/Operation_Paperclip",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — COINTELPRO",               url: "https://en.wikipedia.org/wiki/COINTELPRO",                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Project MKNAOMI",          url: "https://en.wikipedia.org/wiki/Project_MKNAOMI",             type: "custom_url" as const, intervalMinutes: 10080 },
  // Ancient / archaeology
  { name: "Wikipedia — Great Pyramid of Giza",    url: "https://en.wikipedia.org/wiki/Great_Pyramid_of_Giza",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Giza pyramid complex",     url: "https://en.wikipedia.org/wiki/Giza_pyramid_complex",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Pyramid construction",     url: "https://en.wikipedia.org/wiki/Egyptian_pyramid_construction_techniques", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Göbekli Tepe",             url: "https://en.wikipedia.org/wiki/G%C3%B6bekli_Tepe",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Nazca Lines",              url: "https://en.wikipedia.org/wiki/Nazca_Lines",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Stonehenge",               url: "https://en.wikipedia.org/wiki/Stonehenge",                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Atlantis",                 url: "https://en.wikipedia.org/wiki/Atlantis",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Ancient astronauts",       url: "https://en.wikipedia.org/wiki/Ancient_astronauts",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Voynich manuscript",       url: "https://en.wikipedia.org/wiki/Voynich_manuscript",          type: "custom_url" as const, intervalMinutes: 10080 },
  // Other major conspiracy topics (evidence + claims)
  { name: "Wikipedia — Moon landing conspiracy",  url: "https://en.wikipedia.org/wiki/Moon_landing_conspiracy_theories", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Apollo 11",                url: "https://en.wikipedia.org/wiki/Apollo_11",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bilderberg Group",         url: "https://en.wikipedia.org/wiki/Bilderberg_meeting",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bohemian Grove",           url: "https://en.wikipedia.org/wiki/Bohemian_Grove",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Freemasonry",              url: "https://en.wikipedia.org/wiki/Freemasonry",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Skull and Bones",          url: "https://en.wikipedia.org/wiki/Skull_and_Bones",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Jeffrey Epstein",          url: "https://en.wikipedia.org/wiki/Jeffrey_Epstein",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Watergate scandal",        url: "https://en.wikipedia.org/wiki/Watergate_scandal",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Iran-Contra affair",       url: "https://en.wikipedia.org/wiki/Iran%E2%80%93Contra_affair",  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Gulf of Tonkin incident",  url: "https://en.wikipedia.org/wiki/Gulf_of_Tonkin_incident",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Tuskegee Syphilis Study",  url: "https://en.wikipedia.org/wiki/Tuskegee_Syphilis_Study",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Operation Northwoods",     url: "https://en.wikipedia.org/wiki/Operation_Northwoods",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bermuda Triangle",         url: "https://en.wikipedia.org/wiki/Bermuda_Triangle",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — HAARP",                    url: "https://en.wikipedia.org/wiki/High_Frequency_Active_Auroral_Research_Program", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Dyatlov Pass incident",    url: "https://en.wikipedia.org/wiki/Dyatlov_Pass_incident",       type: "custom_url" as const, intervalMinutes: 10080 },
  // Skeptical / analytical sources (calibration)
  { name: "Skeptical Inquirer",                   url: "https://skepticalinquirer.org/feed/",                       type: "rss" as const, intervalMinutes: 1440 },
  { name: "Snopes",                               url: "https://www.snopes.com/feed/",                              type: "rss" as const, intervalMinutes: 720 },
  { name: "RationalWiki — Conspiracy theory",     url: "https://rationalwiki.org/wiki/Conspiracy_theory",           type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Dreams, consciousness exploration, Monroe Institute / Gateway ──────
  // Mainstream sleep/dream science + esoteric consciousness-research
  // sources. Wikipedia gives the skeptical/encyclopedic baseline; the
  // Monroe Institute site gives the practitioner side. CIA FOIA Reading
  // Room is already seeded above — the crawler will discover the
  // declassified Gateway Process document via topic searches.
  // Dreams — science + interpretation
  { name: "Wikipedia — Dream",                    url: "https://en.wikipedia.org/wiki/Dream",                       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Dream interpretation",     url: "https://en.wikipedia.org/wiki/Dream_interpretation",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Oneirology",               url: "https://en.wikipedia.org/wiki/Oneirology",                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Lucid dream",              url: "https://en.wikipedia.org/wiki/Lucid_dream",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — REM sleep",                url: "https://en.wikipedia.org/wiki/Rapid_eye_movement_sleep",    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Non-REM sleep",            url: "https://en.wikipedia.org/wiki/Non-rapid_eye_movement_sleep",type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Nightmare",                url: "https://en.wikipedia.org/wiki/Nightmare",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Sleep paralysis",          url: "https://en.wikipedia.org/wiki/Sleep_paralysis",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Activation-synthesis",     url: "https://en.wikipedia.org/wiki/Activation-synthesis_hypothesis", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — The Interpretation of Dreams (Freud)", url: "https://en.wikipedia.org/wiki/The_Interpretation_of_Dreams", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Sigmund Freud",            url: "https://en.wikipedia.org/wiki/Sigmund_Freud",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Carl Jung",                url: "https://en.wikipedia.org/wiki/Carl_Jung",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Collective unconscious",   url: "https://en.wikipedia.org/wiki/Collective_unconscious",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Archetype",                url: "https://en.wikipedia.org/wiki/Jungian_archetypes",          type: "custom_url" as const, intervalMinutes: 10080 },
  // Monroe Institute / Gateway Experience / consciousness
  { name: "Wikipedia — Monroe Institute",         url: "https://en.wikipedia.org/wiki/Monroe_Institute",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Robert Monroe",            url: "https://en.wikipedia.org/wiki/Robert_Monroe",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Hemi-Sync",                url: "https://en.wikipedia.org/wiki/Hemi-Sync",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Out-of-body experience",   url: "https://en.wikipedia.org/wiki/Out-of-body_experience",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Astral projection",        url: "https://en.wikipedia.org/wiki/Astral_projection",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Binaural beats",           url: "https://en.wikipedia.org/wiki/Binaural_beats",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Altered state of consciousness", url: "https://en.wikipedia.org/wiki/Altered_state_of_consciousness", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Near-death experience",    url: "https://en.wikipedia.org/wiki/Near-death_experience",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Remote viewing",           url: "https://en.wikipedia.org/wiki/Remote_viewing",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Stargate Project (CIA)",   url: "https://en.wikipedia.org/wiki/Stargate_Project",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Monroe Institute (official)",          url: "https://www.monroeinstitute.org",                           type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Game theory / statistical modeling / computing theory / crypto ──────
  // Heavy on foundational Wikipedia entries + academic/tutorial sources.
  // Covers strategy, equilibrium, probability, complexity, cryptography,
  // quantum algorithms, and the technical side of Bitcoin / blockchain.
  // Game theory
  { name: "Wikipedia — Game theory",              url: "https://en.wikipedia.org/wiki/Game_theory",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Nash equilibrium",         url: "https://en.wikipedia.org/wiki/Nash_equilibrium",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Prisoner's dilemma",       url: "https://en.wikipedia.org/wiki/Prisoner%27s_dilemma",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Zero-sum game",            url: "https://en.wikipedia.org/wiki/Zero-sum_game",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Minimax",                  url: "https://en.wikipedia.org/wiki/Minimax",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Pareto efficiency",        url: "https://en.wikipedia.org/wiki/Pareto_efficiency",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Evolutionarily stable strategy", url: "https://en.wikipedia.org/wiki/Evolutionarily_stable_strategy", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Shapley value",            url: "https://en.wikipedia.org/wiki/Shapley_value",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Mechanism design",         url: "https://en.wikipedia.org/wiki/Mechanism_design",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Cooperative game theory",  url: "https://en.wikipedia.org/wiki/Cooperative_game_theory",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bayesian game",            url: "https://en.wikipedia.org/wiki/Bayesian_game",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Subgame perfect equilibrium", url: "https://en.wikipedia.org/wiki/Subgame_perfect_equilibrium", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Extensive-form game",      url: "https://en.wikipedia.org/wiki/Extensive-form_game",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Stackelberg competition",  url: "https://en.wikipedia.org/wiki/Stackelberg_competition",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Folk theorem (game theory)", url: "https://en.wikipedia.org/wiki/Folk_theorem_(game_theory)", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Stanford Encyclopedia — Game theory",  url: "https://plato.stanford.edu/entries/game-theory/",           type: "custom_url" as const, intervalMinutes: 10080 },
  // Statistical modeling / probability
  { name: "Wikipedia — Statistical model",        url: "https://en.wikipedia.org/wiki/Statistical_model",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bayesian inference",       url: "https://en.wikipedia.org/wiki/Bayesian_inference",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Markov chain",             url: "https://en.wikipedia.org/wiki/Markov_chain",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Monte Carlo method",       url: "https://en.wikipedia.org/wiki/Monte_Carlo_method",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Markov chain Monte Carlo", url: "https://en.wikipedia.org/wiki/Markov_chain_Monte_Carlo",    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Hidden Markov model",      url: "https://en.wikipedia.org/wiki/Hidden_Markov_model",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Maximum likelihood",       url: "https://en.wikipedia.org/wiki/Maximum_likelihood_estimation", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Regression analysis",      url: "https://en.wikipedia.org/wiki/Regression_analysis",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Logistic regression",      url: "https://en.wikipedia.org/wiki/Logistic_regression",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Time series",              url: "https://en.wikipedia.org/wiki/Time_series",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — ARIMA",                    url: "https://en.wikipedia.org/wiki/Autoregressive_integrated_moving_average", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Information theory",       url: "https://en.wikipedia.org/wiki/Information_theory",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Entropy (information)",    url: "https://en.wikipedia.org/wiki/Entropy_(information_theory)", type: "custom_url" as const, intervalMinutes: 10080 },
  // Computing theory / complexity
  { name: "Wikipedia — Theory of computation",    url: "https://en.wikipedia.org/wiki/Theory_of_computation",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Turing machine",           url: "https://en.wikipedia.org/wiki/Turing_machine",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Computational complexity", url: "https://en.wikipedia.org/wiki/Computational_complexity_theory", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — P versus NP",              url: "https://en.wikipedia.org/wiki/P_versus_NP_problem",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Big O notation",           url: "https://en.wikipedia.org/wiki/Big_O_notation",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Church-Turing thesis",     url: "https://en.wikipedia.org/wiki/Church%E2%80%93Turing_thesis", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Halting problem",          url: "https://en.wikipedia.org/wiki/Halting_problem",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Kolmogorov complexity",    url: "https://en.wikipedia.org/wiki/Kolmogorov_complexity",       type: "custom_url" as const, intervalMinutes: 10080 },
  // Quantum computing & algorithms
  { name: "Wikipedia — Quantum computing",        url: "https://en.wikipedia.org/wiki/Quantum_computing",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Shor's algorithm",         url: "https://en.wikipedia.org/wiki/Shor%27s_algorithm",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Grover's algorithm",       url: "https://en.wikipedia.org/wiki/Grover%27s_algorithm",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Quantum algorithm",        url: "https://en.wikipedia.org/wiki/Quantum_algorithm",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Qubit",                    url: "https://en.wikipedia.org/wiki/Qubit",                       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Quantum supremacy",        url: "https://en.wikipedia.org/wiki/Quantum_supremacy",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — BQP",                      url: "https://en.wikipedia.org/wiki/BQP",                         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "ArXiv Quantum Physics",                url: "https://arxiv.org/rss/quant-ph",                            type: "rss" as const, intervalMinutes: 60 },
  // Cryptography
  { name: "Wikipedia — Cryptography",             url: "https://en.wikipedia.org/wiki/Cryptography",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Public-key cryptography",  url: "https://en.wikipedia.org/wiki/Public-key_cryptography",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — RSA cryptosystem",         url: "https://en.wikipedia.org/wiki/RSA_(cryptosystem)",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Elliptic-curve cryptography", url: "https://en.wikipedia.org/wiki/Elliptic-curve_cryptography", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — SHA-256",                  url: "https://en.wikipedia.org/wiki/SHA-2",                       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Post-quantum cryptography", url: "https://en.wikipedia.org/wiki/Post-quantum_cryptography",  type: "custom_url" as const, intervalMinutes: 10080 },
  // Bitcoin / blockchain (technical)
  { name: "Bitcoin whitepaper (Satoshi)",         url: "https://bitcoin.org/bitcoin.pdf",                           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Bitcoin.org — Developer Guide",        url: "https://developer.bitcoin.org/devguide/",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bitcoin",                  url: "https://en.wikipedia.org/wiki/Bitcoin",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bitcoin mining",           url: "https://en.wikipedia.org/wiki/Bitcoin_network#Mining",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Proof of work",            url: "https://en.wikipedia.org/wiki/Proof_of_work",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Proof of stake",           url: "https://en.wikipedia.org/wiki/Proof_of_stake",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Blockchain",               url: "https://en.wikipedia.org/wiki/Blockchain",                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Merkle tree",              url: "https://en.wikipedia.org/wiki/Merkle_tree",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Byzantine fault",          url: "https://en.wikipedia.org/wiki/Byzantine_fault",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Ethereum",                 url: "https://en.wikipedia.org/wiki/Ethereum",                    type: "custom_url" as const, intervalMinutes: 10080 },
  // Strategy / decision theory / optimization
  { name: "Wikipedia — Decision theory",          url: "https://en.wikipedia.org/wiki/Decision_theory",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Linear programming",       url: "https://en.wikipedia.org/wiki/Linear_programming",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Dynamic programming",      url: "https://en.wikipedia.org/wiki/Dynamic_programming",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Operations research",      url: "https://en.wikipedia.org/wiki/Operations_research",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Reinforcement learning",   url: "https://en.wikipedia.org/wiki/Reinforcement_learning",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Multi-armed bandit",       url: "https://en.wikipedia.org/wiki/Multi-armed_bandit",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Kelly criterion",          url: "https://en.wikipedia.org/wiki/Kelly_criterion",             type: "custom_url" as const, intervalMinutes: 10080 },
  // RF / Wireless / EMP / Electronic Warfare
  { name: "Wikipedia — Radio jamming",             url: "https://en.wikipedia.org/wiki/Radio_jamming",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Electromagnetic pulse",     url: "https://en.wikipedia.org/wiki/Electromagnetic_pulse",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bluetooth hacking",         url: "https://en.wikipedia.org/wiki/Bluesnarfing",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bluebugging",               url: "https://en.wikipedia.org/wiki/Bluebugging",                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Wi-Fi deauthentication",    url: "https://en.wikipedia.org/wiki/Wi-Fi_deauthentication_attack", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Software-defined radio",    url: "https://en.wikipedia.org/wiki/Software-defined_radio",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Electronic warfare",        url: "https://en.wikipedia.org/wiki/Electronic_warfare",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — IMSI-catcher",              url: "https://en.wikipedia.org/wiki/IMSI-catcher",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Faraday cage",              url: "https://en.wikipedia.org/wiki/Faraday_cage",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — TEMPEST",                   url: "https://en.wikipedia.org/wiki/Tempest_(codename)",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Signals intelligence",      url: "https://en.wikipedia.org/wiki/Signals_intelligence",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — GPS spoofing",              url: "https://en.wikipedia.org/wiki/Spoofing_attack#GPS_spoofing", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Directed-energy weapon",    url: "https://en.wikipedia.org/wiki/Directed-energy_weapon",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — RFID skimming",             url: "https://en.wikipedia.org/wiki/RFID_skimming",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Van Eck phreaking",         url: "https://en.wikipedia.org/wiki/Van_Eck_phreaking",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Carrington Event",          url: "https://en.wikipedia.org/wiki/Carrington_Event",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Frequency-hopping spread spectrum", url: "https://en.wikipedia.org/wiki/Frequency-hopping_spread_spectrum", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Electronic countermeasure", url: "https://en.wikipedia.org/wiki/Electronic_countermeasure",    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — High-altitude EMP",         url: "https://en.wikipedia.org/wiki/High-altitude_electromagnetic_pulse", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bluetooth Low Energy security", url: "https://en.wikipedia.org/wiki/Bluetooth_Low_Energy",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "HackRF — Great Scott Gadgets",          url: "https://greatscottgadgets.com/hackrf/",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "RTL-SDR Blog",                          url: "https://www.rtl-sdr.com/feed/",                              type: "rss" as const, intervalMinutes: 360 },
  { name: "Hackaday — Wireless",                   url: "https://hackaday.com/category/wireless-hacks/feed/",          type: "rss" as const, intervalMinutes: 360 },
  { name: "Hackaday — Radio",                      url: "https://hackaday.com/category/radio-hacks/feed/",             type: "rss" as const, intervalMinutes: 360 },
  // Finance / Investing / Accounting
  { name: "Wikipedia — Discounted cash flow",      url: "https://en.wikipedia.org/wiki/Discounted_cash_flow",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Capital asset pricing model", url: "https://en.wikipedia.org/wiki/Capital_asset_pricing_model", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Modern portfolio theory",   url: "https://en.wikipedia.org/wiki/Modern_portfolio_theory",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Black-Scholes model",       url: "https://en.wikipedia.org/wiki/Black%E2%80%93Scholes_model",  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Efficient-market hypothesis", url: "https://en.wikipedia.org/wiki/Efficient-market_hypothesis", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Value investing",           url: "https://en.wikipedia.org/wiki/Value_investing",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Venture capital",           url: "https://en.wikipedia.org/wiki/Venture_capital",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Leveraged buyout",          url: "https://en.wikipedia.org/wiki/Leveraged_buyout",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Financial statement analysis", url: "https://en.wikipedia.org/wiki/Financial_statement_analysis", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Behavioral economics",     url: "https://en.wikipedia.org/wiki/Behavioral_economics",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Net present value",         url: "https://en.wikipedia.org/wiki/Net_present_value",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Mergers and acquisitions",  url: "https://en.wikipedia.org/wiki/Mergers_and_acquisitions",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Investopedia — Financial Terms",        url: "https://www.investopedia.com/financial-term-dictionary-4769738", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Investopedia — Investing",              url: "https://www.investopedia.com/investing-4427685",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Investopedia — Corporate Finance",      url: "https://www.investopedia.com/corporate-finance-4689788",      type: "custom_url" as const, intervalMinutes: 10080 },
  // Marketing / Sales / Entrepreneurship
  { name: "Wikipedia — Marketing strategy",        url: "https://en.wikipedia.org/wiki/Marketing_strategy",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Search engine optimization", url: "https://en.wikipedia.org/wiki/Search_engine_optimization",  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Conversion rate optimization", url: "https://en.wikipedia.org/wiki/Conversion_rate_optimization", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Business model canvas",     url: "https://en.wikipedia.org/wiki/Business_Model_Canvas",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Lean startup",              url: "https://en.wikipedia.org/wiki/Lean_startup",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Product-market fit",        url: "https://en.wikipedia.org/wiki/Product/market_fit",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Network effect",            url: "https://en.wikipedia.org/wiki/Network_effect",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Porter's five forces",      url: "https://en.wikipedia.org/wiki/Porter%27s_five_forces_analysis", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Blue ocean strategy",       url: "https://en.wikipedia.org/wiki/Blue_Ocean_Strategy",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — SPIN selling",              url: "https://en.wikipedia.org/wiki/SPIN_selling",                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Six Sigma",                 url: "https://en.wikipedia.org/wiki/Six_Sigma",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Balanced scorecard",        url: "https://en.wikipedia.org/wiki/Balanced_scorecard",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Paul Graham Essays",                   url: "https://www.paulgraham.com/articles.html",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Y Combinator Blog",                    url: "https://www.ycombinator.com/blog/rss",                        type: "rss" as const, intervalMinutes: 360 },
  { name: "Harvard Business Review",              url: "https://hbr.org/rss",                                         type: "rss" as const, intervalMinutes: 360 },
  { name: "Seth Godin Blog",                      url: "https://seths.blog/feed/",                                    type: "rss" as const, intervalMinutes: 360 },
  { name: "First Round Review",                   url: "https://review.firstround.com/rss",                           type: "rss" as const, intervalMinutes: 360 },
  { name: "a16z Blog",                            url: "https://a16z.com/feed/",                                      type: "rss" as const, intervalMinutes: 360 },
  { name: "Stratechery by Ben Thompson",          url: "https://stratechery.com/feed/",                                type: "rss" as const, intervalMinutes: 360 },
  // Research feeds
  { name: "ArXiv Game Theory (cs.GT)",            url: "https://arxiv.org/rss/cs.GT",                               type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv Statistics Theory",              url: "https://arxiv.org/rss/math.ST",                             type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv Computational Complexity",       url: "https://arxiv.org/rss/cs.CC",                               type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv Information Theory",             url: "https://arxiv.org/rss/cs.IT",                               type: "rss" as const, intervalMinutes: 60 },

  // ── Health — natural medicine, ancestral nutrition, sun, fasting, gut health ──
  // Focus: effects of sun exposure, exercise, fasting, raw dairy, pastured eggs,
  // red meat, fermented foods, starches, and gut-cleaning protocols. Mix of
  // advocacy foundations (Weston A. Price / Real Milk), fasting physicians
  // (Jason Fung), circadian/light research, ancestral-health blogs, and
  // Wikipedia references for mechanisms (vitamin D, autophagy, microbiome).
  // Scraper/entity extractor will tag these as "health".

  // Foundations / advocacy
  { name: "Weston A. Price Foundation",            url: "https://www.westonaprice.org",                              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Weston A. Price — Wise Traditions (RSS)", url: "https://www.westonaprice.org/feed/",                      type: "rss" as const, intervalMinutes: 360 },
  { name: "A Campaign for Real Milk",              url: "https://www.realmilk.com",                                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Real Milk — News (RSS)",                url: "https://www.realmilk.com/feed/",                            type: "rss" as const, intervalMinutes: 360 },
  { name: "Price-Pottenger Nutrition Foundation",  url: "https://price-pottenger.org",                               type: "custom_url" as const, intervalMinutes: 10080 },

  // Fasting / metabolic
  { name: "The Fasting Method (Jason Fung)",       url: "https://www.thefastingmethod.com",                          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Dr. Jason Fung — Medium",               url: "https://drjasonfung.medium.com/feed",                       type: "rss" as const, intervalMinutes: 360 },
  { name: "Peter Attia — Blog (RSS)",              url: "https://peterattiamd.com/feed/",                            type: "rss" as const, intervalMinutes: 360 },
  { name: "Wikipedia — Intermittent fasting",      url: "https://en.wikipedia.org/wiki/Intermittent_fasting",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Autophagy",                 url: "https://en.wikipedia.org/wiki/Autophagy",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Ketogenic diet",            url: "https://en.wikipedia.org/wiki/Ketogenic_diet",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Ketosis",                   url: "https://en.wikipedia.org/wiki/Ketosis",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Caloric restriction",       url: "https://en.wikipedia.org/wiki/Caloric_restriction",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Insulin resistance",        url: "https://en.wikipedia.org/wiki/Insulin_resistance",          type: "custom_url" as const, intervalMinutes: 10080 },

  // Sun / circadian / light
  { name: "Wikipedia — Vitamin D",                 url: "https://en.wikipedia.org/wiki/Vitamin_D",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Sunlight",                  url: "https://en.wikipedia.org/wiki/Sunlight",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Circadian rhythm",          url: "https://en.wikipedia.org/wiki/Circadian_rhythm",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Nitric oxide",              url: "https://en.wikipedia.org/wiki/Nitric_oxide",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Melatonin",                 url: "https://en.wikipedia.org/wiki/Melatonin",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Ultraviolet — health effects", url: "https://en.wikipedia.org/wiki/Health_effects_of_sunlight_exposure", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Grounding (alternative medicine)", url: "https://en.wikipedia.org/wiki/Grounding_(alternative_medicine)", type: "custom_url" as const, intervalMinutes: 10080 },

  // Exercise / movement
  { name: "Wikipedia — Exercise physiology",       url: "https://en.wikipedia.org/wiki/Exercise_physiology",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Strength training",         url: "https://en.wikipedia.org/wiki/Strength_training",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — High-intensity interval training", url: "https://en.wikipedia.org/wiki/High-intensity_interval_training", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — VO2 max",                   url: "https://en.wikipedia.org/wiki/VO2_max",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Zone 2 training",           url: "https://en.wikipedia.org/wiki/Aerobic_exercise",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Mitochondrial biogenesis",  url: "https://en.wikipedia.org/wiki/Mitochondrial_biogenesis",    type: "custom_url" as const, intervalMinutes: 10080 },

  // Ancestral nutrition — raw milk, eggs, steak, yogurt, potatoes, organ meats
  { name: "Wikipedia — Raw milk",                  url: "https://en.wikipedia.org/wiki/Raw_milk",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — A2 milk",                   url: "https://en.wikipedia.org/wiki/A2_milk",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Egg as food",               url: "https://en.wikipedia.org/wiki/Egg_as_food",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Beef — nutrition",          url: "https://en.wikipedia.org/wiki/Beef",                        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Yogurt",                    url: "https://en.wikipedia.org/wiki/Yogurt",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Kefir",                     url: "https://en.wikipedia.org/wiki/Kefir",                       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Fermentation in food processing", url: "https://en.wikipedia.org/wiki/Fermentation_in_food_processing", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Potato — nutrition",        url: "https://en.wikipedia.org/wiki/Potato",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Resistant starch",          url: "https://en.wikipedia.org/wiki/Resistant_starch",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Offal (organ meats)",       url: "https://en.wikipedia.org/wiki/Offal",                       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bone broth",                url: "https://en.wikipedia.org/wiki/Bone_broth",                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Grass-fed beef",            url: "https://en.wikipedia.org/wiki/Grass-fed_beef",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Pastoralism / pastured",    url: "https://en.wikipedia.org/wiki/Pastoralism",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Saturated fat",             url: "https://en.wikipedia.org/wiki/Saturated_fat",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Cholesterol",               url: "https://en.wikipedia.org/wiki/Cholesterol",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Seed oils (industrial)",    url: "https://en.wikipedia.org/wiki/Vegetable_oil",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Omega-3 fatty acid",        url: "https://en.wikipedia.org/wiki/Omega-3_fatty_acid",          type: "custom_url" as const, intervalMinutes: 10080 },

  // Ancestral diet movements
  { name: "Wikipedia — Paleolithic diet",          url: "https://en.wikipedia.org/wiki/Paleolithic_diet",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Carnivore diet",            url: "https://en.wikipedia.org/wiki/Meat#Nutritional_information", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Weston A. Price",           url: "https://en.wikipedia.org/wiki/Weston_Price",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Nutrition and Physical Degeneration", url: "https://en.wikipedia.org/wiki/Nutrition_and_Physical_Degeneration", type: "custom_url" as const, intervalMinutes: 10080 },

  // Gut health / microbiome / cleanse
  { name: "Wikipedia — Human microbiome",          url: "https://en.wikipedia.org/wiki/Human_microbiome",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Gut microbiota",            url: "https://en.wikipedia.org/wiki/Human_gastrointestinal_microbiota", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Probiotic",                 url: "https://en.wikipedia.org/wiki/Probiotic",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Prebiotic",                 url: "https://en.wikipedia.org/wiki/Prebiotic_(nutrition)",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Leaky gut syndrome",        url: "https://en.wikipedia.org/wiki/Leaky_gut_syndrome",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Small intestinal bacterial overgrowth", url: "https://en.wikipedia.org/wiki/Small_intestinal_bacterial_overgrowth", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Candidiasis",               url: "https://en.wikipedia.org/wiki/Candidiasis",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Lactobacillus",             url: "https://en.wikipedia.org/wiki/Lactobacillus",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Short-chain fatty acid",    url: "https://en.wikipedia.org/wiki/Short-chain_fatty_acid",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Elimination diet",          url: "https://en.wikipedia.org/wiki/Elimination_diet",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Glyphosate — health concerns", url: "https://en.wikipedia.org/wiki/Glyphosate",              type: "custom_url" as const, intervalMinutes: 10080 },

  // ── Physics — classical to modern ─────────────────────────────────────────
  // Classical mechanics → electromagnetism → thermodynamics → stat mech →
  // special/general relativity → quantum mechanics → QFT / particle physics →
  // cosmology / astrophysics. Mix of ArXiv feeds (active research), MIT OCW
  // and HyperPhysics (foundations), and Wikipedia deep-dives on key concepts
  // and equations. Entity extractor tags these as "physics".

  // Research feeds
  { name: "ArXiv — High Energy Physics Theory",    url: "https://arxiv.org/rss/hep-th",                              type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv — High Energy Physics Phenom.",   url: "https://arxiv.org/rss/hep-ph",                              type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv — General Relativity / QC",       url: "https://arxiv.org/rss/gr-qc",                               type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv — Quantum Physics",               url: "https://arxiv.org/rss/quant-ph",                            type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv — Condensed Matter",              url: "https://arxiv.org/rss/cond-mat",                            type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv — Astrophysics",                  url: "https://arxiv.org/rss/astro-ph",                            type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv — Classical Physics",             url: "https://arxiv.org/rss/physics.class-ph",                    type: "rss" as const, intervalMinutes: 60 },
  { name: "ArXiv — Mathematical Physics",          url: "https://arxiv.org/rss/math-ph",                             type: "rss" as const, intervalMinutes: 60 },
  { name: "Physical Review Letters — highlights",  url: "https://journals.aps.org/prl/rss",                          type: "rss" as const, intervalMinutes: 120 },
  { name: "Nature Physics (RSS)",                  url: "https://www.nature.com/nphys.rss",                          type: "rss" as const, intervalMinutes: 120 },
  { name: "Physics Today",                         url: "https://physicstoday.scitation.org/feed/most-recent.rss",   type: "rss" as const, intervalMinutes: 360 },
  { name: "APS Physics Magazine",                  url: "https://physics.aps.org/rss",                               type: "rss" as const, intervalMinutes: 360 },
  { name: "Quanta Magazine — Physics",             url: "https://www.quantamagazine.org/feed/",                      type: "rss" as const, intervalMinutes: 360 },

  // Course material / authoritative references
  { name: "MIT OCW — Physics",                     url: "https://ocw.mit.edu/courses/physics/",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "MIT OCW — Classical Mechanics (8.01)",  url: "https://ocw.mit.edu/courses/8-01sc-classical-mechanics-fall-2016/", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "MIT OCW — Electromagnetism (8.02)",     url: "https://ocw.mit.edu/courses/8-02-physics-ii-electricity-and-magnetism-spring-2007/", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "MIT OCW — Quantum Physics (8.04)",      url: "https://ocw.mit.edu/courses/8-04-quantum-physics-i-spring-2016/", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "MIT OCW — Statistical Mechanics (8.333)", url: "https://ocw.mit.edu/courses/8-333-statistical-mechanics-i-statistical-mechanics-of-particles-fall-2013/", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Feynman Lectures on Physics",           url: "https://www.feynmanlectures.caltech.edu",                   type: "custom_url" as const, intervalMinutes: 10080 },

  // Classical mechanics
  { name: "Wikipedia — Classical mechanics",       url: "https://en.wikipedia.org/wiki/Classical_mechanics",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Newton's laws of motion",   url: "https://en.wikipedia.org/wiki/Newton%27s_laws_of_motion",   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Lagrangian mechanics",      url: "https://en.wikipedia.org/wiki/Lagrangian_mechanics",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Hamiltonian mechanics",     url: "https://en.wikipedia.org/wiki/Hamiltonian_mechanics",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Noether's theorem",         url: "https://en.wikipedia.org/wiki/Noether%27s_theorem",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Kepler's laws",             url: "https://en.wikipedia.org/wiki/Kepler%27s_laws_of_planetary_motion", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Conservation of energy",    url: "https://en.wikipedia.org/wiki/Conservation_of_energy",      type: "custom_url" as const, intervalMinutes: 10080 },

  // Electromagnetism & optics
  { name: "Wikipedia — Electromagnetism",          url: "https://en.wikipedia.org/wiki/Electromagnetism",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Maxwell's equations",       url: "https://en.wikipedia.org/wiki/Maxwell%27s_equations",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Electromagnetic radiation", url: "https://en.wikipedia.org/wiki/Electromagnetic_radiation",   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Optics",                    url: "https://en.wikipedia.org/wiki/Optics",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Wave–particle duality",     url: "https://en.wikipedia.org/wiki/Wave%E2%80%93particle_duality", type: "custom_url" as const, intervalMinutes: 10080 },

  // Thermodynamics & statistical mechanics
  { name: "Wikipedia — Thermodynamics",            url: "https://en.wikipedia.org/wiki/Thermodynamics",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Laws of thermodynamics",    url: "https://en.wikipedia.org/wiki/Laws_of_thermodynamics",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Entropy",                   url: "https://en.wikipedia.org/wiki/Entropy",                     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Statistical mechanics",     url: "https://en.wikipedia.org/wiki/Statistical_mechanics",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Boltzmann distribution",    url: "https://en.wikipedia.org/wiki/Boltzmann_distribution",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Partition function",        url: "https://en.wikipedia.org/wiki/Partition_function_(statistical_mechanics)", type: "custom_url" as const, intervalMinutes: 10080 },

  // Relativity
  { name: "Wikipedia — Special relativity",        url: "https://en.wikipedia.org/wiki/Special_relativity",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — General relativity",        url: "https://en.wikipedia.org/wiki/General_relativity",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Einstein field equations",  url: "https://en.wikipedia.org/wiki/Einstein_field_equations",    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Spacetime",                 url: "https://en.wikipedia.org/wiki/Spacetime",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Black hole",                url: "https://en.wikipedia.org/wiki/Black_hole",                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Gravitational wave",        url: "https://en.wikipedia.org/wiki/Gravitational_wave",          type: "custom_url" as const, intervalMinutes: 10080 },

  // Quantum mechanics
  { name: "Wikipedia — Quantum mechanics",         url: "https://en.wikipedia.org/wiki/Quantum_mechanics",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Schrödinger equation",      url: "https://en.wikipedia.org/wiki/Schr%C3%B6dinger_equation",   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Heisenberg uncertainty",    url: "https://en.wikipedia.org/wiki/Uncertainty_principle",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Quantum entanglement",      url: "https://en.wikipedia.org/wiki/Quantum_entanglement",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Superposition principle",   url: "https://en.wikipedia.org/wiki/Quantum_superposition",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Quantum decoherence",       url: "https://en.wikipedia.org/wiki/Quantum_decoherence",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Path integral formulation", url: "https://en.wikipedia.org/wiki/Path_integral_formulation",   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Interpretations of QM",     url: "https://en.wikipedia.org/wiki/Interpretations_of_quantum_mechanics", type: "custom_url" as const, intervalMinutes: 10080 },

  // QFT / particle / Standard Model
  { name: "Wikipedia — Quantum field theory",      url: "https://en.wikipedia.org/wiki/Quantum_field_theory",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Standard Model",            url: "https://en.wikipedia.org/wiki/Standard_Model",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Quantum electrodynamics",   url: "https://en.wikipedia.org/wiki/Quantum_electrodynamics",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Quantum chromodynamics",    url: "https://en.wikipedia.org/wiki/Quantum_chromodynamics",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Higgs boson",               url: "https://en.wikipedia.org/wiki/Higgs_boson",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Gauge theory",              url: "https://en.wikipedia.org/wiki/Gauge_theory",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Supersymmetry",             url: "https://en.wikipedia.org/wiki/Supersymmetry",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — String theory",             url: "https://en.wikipedia.org/wiki/String_theory",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Loop quantum gravity",      url: "https://en.wikipedia.org/wiki/Loop_quantum_gravity",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "CERN — News",                           url: "https://home.cern/news",                                    type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "Fermilab — News",                       url: "https://news.fnal.gov",                                     type: "custom_url" as const, intervalMinutes: 1440 },
  { name: "Particle Data Group",                   url: "https://pdg.lbl.gov",                                       type: "custom_url" as const, intervalMinutes: 10080 },

  // Cosmology / astrophysics
  { name: "Wikipedia — Cosmology",                 url: "https://en.wikipedia.org/wiki/Cosmology",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Big Bang",                  url: "https://en.wikipedia.org/wiki/Big_Bang",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Cosmic microwave background", url: "https://en.wikipedia.org/wiki/Cosmic_microwave_background", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Dark matter",               url: "https://en.wikipedia.org/wiki/Dark_matter",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Dark energy",               url: "https://en.wikipedia.org/wiki/Dark_energy",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Cosmic inflation",          url: "https://en.wikipedia.org/wiki/Inflation_(cosmology)",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Lambda-CDM model",          url: "https://en.wikipedia.org/wiki/Lambda-CDM_model",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Hubble's law",              url: "https://en.wikipedia.org/wiki/Hubble%27s_law",              type: "custom_url" as const, intervalMinutes: 10080 },

  // Condensed matter / solid state
  { name: "Wikipedia — Condensed matter physics",  url: "https://en.wikipedia.org/wiki/Condensed_matter_physics",    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Solid-state physics",       url: "https://en.wikipedia.org/wiki/Solid-state_physics",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Superconductivity",         url: "https://en.wikipedia.org/wiki/Superconductivity",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Bose–Einstein condensate",  url: "https://en.wikipedia.org/wiki/Bose%E2%80%93Einstein_condensate", type: "custom_url" as const, intervalMinutes: 10080 },

  // Foundations / philosophy of physics
  { name: "Wikipedia — Principle of least action", url: "https://en.wikipedia.org/wiki/Principle_of_least_action",   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Symmetry in physics",       url: "https://en.wikipedia.org/wiki/Symmetry_(physics)",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Fine-tuned universe",       url: "https://en.wikipedia.org/wiki/Fine-tuned_universe",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Stanford Encyclopedia — Philosophy of Physics", url: "https://plato.stanford.edu/entries/physics-experiment/", type: "custom_url" as const, intervalMinutes: 10080 },

  // ──────────────────────────────────────────────────────────────────────────
  // Language / Grammar / Punctuation / Style / English usage (v14)
  // ──────────────────────────────────────────────────────────────────────────

  // Style guides & authoritative references
  { name: "Grammar Girl (Mignon Fogarty)",         url: "https://feeds.feedburner.com/GrammarGirl",                  type: "rss" as const,        intervalMinutes: 720 },
  { name: "Chicago Manual of Style — Shop Talk",   url: "https://cmosshoptalk.com/feed/",                            type: "rss" as const,        intervalMinutes: 720 },
  { name: "Merriam-Webster — Word Matters",        url: "https://www.merriam-webster.com/rss/word-of-the-day",       type: "rss" as const,        intervalMinutes: 1440 },
  { name: "Grammarly Blog",                        url: "https://www.grammarly.com/blog/feed/",                      type: "rss" as const,        intervalMinutes: 1440 },
  { name: "Oxford Dictionaries — Blog",            url: "https://blog.oup.com/category/lexicography/feed/",          type: "rss" as const,        intervalMinutes: 1440 },
  { name: "Purdue OWL — Home",                     url: "https://owl.purdue.edu/owl/purdue_owl.html",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Purdue OWL — Grammar",                  url: "https://owl.purdue.edu/owl/general_writing/grammar/index.html", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Purdue OWL — Punctuation",              url: "https://owl.purdue.edu/owl/general_writing/punctuation/index.html", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Purdue OWL — Mechanics",                url: "https://owl.purdue.edu/owl/general_writing/mechanics/index.html", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Purdue OWL — Sentence Structure",       url: "https://owl.purdue.edu/owl/general_writing/mechanics/sentence_variety.html", type: "custom_url" as const, intervalMinutes: 10080 },

  // Parts of speech & grammar fundamentals
  { name: "Wikipedia — English grammar",           url: "https://en.wikipedia.org/wiki/English_grammar",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Part of speech",            url: "https://en.wikipedia.org/wiki/Part_of_speech",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — English verbs",             url: "https://en.wikipedia.org/wiki/English_verbs",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — English nouns",             url: "https://en.wikipedia.org/wiki/English_nouns",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — English pronouns",          url: "https://en.wikipedia.org/wiki/English_pronouns",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — English adjectives",        url: "https://en.wikipedia.org/wiki/English_adjectives",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — English adverbs",           url: "https://en.wikipedia.org/wiki/English_adverbs",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — English prepositions",      url: "https://en.wikipedia.org/wiki/English_prepositions",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — English conjunctions",      url: "https://en.wikipedia.org/wiki/English_conjunctions",        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Determiner (linguistics)",  url: "https://en.wikipedia.org/wiki/Determiner",                  type: "custom_url" as const, intervalMinutes: 10080 },

  // Syntax & sentence structure
  { name: "Wikipedia — Syntax",                    url: "https://en.wikipedia.org/wiki/Syntax",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Clause",                    url: "https://en.wikipedia.org/wiki/Clause",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Independent clause",        url: "https://en.wikipedia.org/wiki/Independent_clause",          type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Dependent clause",          url: "https://en.wikipedia.org/wiki/Dependent_clause",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Sentence (linguistics)",    url: "https://en.wikipedia.org/wiki/Sentence_(linguistics)",      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Sentence fragment",         url: "https://en.wikipedia.org/wiki/Sentence_clause_structure",   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Run-on sentence",           url: "https://en.wikipedia.org/wiki/Run-on_sentence",             type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Comma splice",              url: "https://en.wikipedia.org/wiki/Comma_splice",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Dangling modifier",         url: "https://en.wikipedia.org/wiki/Dangling_modifier",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Passive voice",             url: "https://en.wikipedia.org/wiki/Passive_voice",               type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Split infinitive",          url: "https://en.wikipedia.org/wiki/Split_infinitive",            type: "custom_url" as const, intervalMinutes: 10080 },

  // Punctuation
  { name: "Wikipedia — Punctuation",               url: "https://en.wikipedia.org/wiki/Punctuation",                 type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — English punctuation",       url: "https://en.wikipedia.org/wiki/English_punctuation",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Comma",                     url: "https://en.wikipedia.org/wiki/Comma",                       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Serial comma",              url: "https://en.wikipedia.org/wiki/Serial_comma",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Semicolon",                 url: "https://en.wikipedia.org/wiki/Semicolon",                   type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Colon (punctuation)",       url: "https://en.wikipedia.org/wiki/Colon_(punctuation)",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Dash",                      url: "https://en.wikipedia.org/wiki/Dash",                        type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Hyphen",                    url: "https://en.wikipedia.org/wiki/Hyphen",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Apostrophe",                url: "https://en.wikipedia.org/wiki/Apostrophe",                  type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Quotation marks",           url: "https://en.wikipedia.org/wiki/Quotation_mark",              type: "custom_url" as const, intervalMinutes: 10080 },

  // Capitalization & orthography
  { name: "Wikipedia — Capitalization",            url: "https://en.wikipedia.org/wiki/Capitalization",              type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — English orthography",       url: "https://en.wikipedia.org/wiki/English_orthography",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Title case",                url: "https://en.wikipedia.org/wiki/Title_case",                  type: "custom_url" as const, intervalMinutes: 10080 },

  // Usage / common errors
  { name: "Wikipedia — Commonly confused English words", url: "https://en.wikipedia.org/wiki/Commonly_misused_English_words", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Subject-verb agreement",    url: "https://en.wikipedia.org/wiki/Agreement_(linguistics)",     type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — English modal verbs",       url: "https://en.wikipedia.org/wiki/English_modal_verbs",         type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Grammatical tense",         url: "https://en.wikipedia.org/wiki/Grammatical_tense",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Grammatical mood",          url: "https://en.wikipedia.org/wiki/Grammatical_mood",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Grammatical aspect",        url: "https://en.wikipedia.org/wiki/Grammatical_aspect",          type: "custom_url" as const, intervalMinutes: 10080 },

  // Style & composition
  { name: "Wikipedia — The Elements of Style",     url: "https://en.wikipedia.org/wiki/The_Elements_of_Style",       type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Fowler's Modern English Usage", url: "https://en.wikipedia.org/wiki/A_Dictionary_of_Modern_English_Usage", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Chicago Manual of Style",   url: "https://en.wikipedia.org/wiki/The_Chicago_Manual_of_Style", type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — AP Stylebook",              url: "https://en.wikipedia.org/wiki/AP_Stylebook",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — MLA Handbook",              url: "https://en.wikipedia.org/wiki/MLA_Handbook",                type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — APA style",                 url: "https://en.wikipedia.org/wiki/APA_style",                   type: "custom_url" as const, intervalMinutes: 10080 },

  // Rhetoric & rhetorical devices
  { name: "Wikipedia — Rhetoric",                  url: "https://en.wikipedia.org/wiki/Rhetoric",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Rhetorical device",         url: "https://en.wikipedia.org/wiki/Rhetorical_device",           type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Figure of speech",          url: "https://en.wikipedia.org/wiki/Figure_of_speech",            type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Metaphor",                  url: "https://en.wikipedia.org/wiki/Metaphor",                    type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Simile",                    url: "https://en.wikipedia.org/wiki/Simile",                      type: "custom_url" as const, intervalMinutes: 10080 },
  { name: "Wikipedia — Modes of persuasion",       url: "https://en.wikipedia.org/wiki/Modes_of_persuasion",         type: "custom_url" as const, intervalMinutes: 10080 },
];

export async function startBackgroundServices(): Promise<void> {
  await logger.info("services", "Initializing ALL background services...");

  // Initialize LLM settings first
  await initializeDefaultSettings();

  // Hydrate the runtime temperature override from persisted creativity setting
  // so every LLM call through ollama.ts honors the last-saved slider value.
  try {
    const creativityRaw = await getSetting("creativity");
    const creativity = parseFloat(creativityRaw || "5");
    if (!isNaN(creativity)) {
      const { setTemperatureOverride } = await import("./ollama.js");
      setTemperatureOverride((creativity / 10) * 1.5);
    }
  } catch (err) {
    await logger.warn("services", `Failed to hydrate creativity setting: ${err}`);
  }

  // Seed any default sources missing from the DB. Idempotent — adds new
  // entries from DEFAULT_SOURCES that aren't already present by URL, so
  // adding new feeds to the default list eventually backfills running
  // installs without wiping user-added sources.
  try {
    const existing = await getScrapeSources();
    const existingUrls = new Set(existing.map((s: any) => s.url));
    const missing = DEFAULT_SOURCES.filter(s => !existingUrls.has(s.url));

    if (missing.length > 0) {
      await logger.info("services", `Seeding ${missing.length} missing default RSS sources (${existing.length} already present)...`);
      for (const source of missing) {
        await addScrapeSource(source);
      }
      await logger.info("services", `Seeded ${missing.length} default sources`);

      // Run an initial scrape only on first run (when the DB was empty),
      // not on every backfill — backfilled sources will get picked up by
      // the regular scheduler.
      if (existing.length === 0) {
        await logger.info("services", "Running initial scrape...");
        try {
          const result = await scrapeAllSources();
          await logger.info("services", `Initial scrape: ${result.succeeded} succeeded, ${result.failed} failed`);
        } catch (err) {
          await logger.warn("services", `Initial scrape failed: ${String(err)}`);
        }
      }
    }
  } catch (err) {
    await logger.warn("services", `Failed to seed sources: ${String(err)}`);
  }

  // Kick off dedup cache init in the BACKGROUND so unrelated services (memory,
  // voice, goals, entity graph, etc.) can start in parallel. The scraper and
  // source-discovery schedulers, however, MUST wait for the cache to be ready —
  // otherwise they scrape with an empty hash set and store duplicates of
  // content the DB already has. First boot on 942k chunks takes a few minutes
  // to rebuild the cache from scratch; after that, dedup-cache.json loads in
  // ~1s and the scrapers start almost immediately.
  const scraperInterval = parseInt(process.env.SCRAPER_INTERVAL_MS ?? "60000");
  try {
    const persisted = await getSetting("scraper_enabled");
    if (persisted === "false") {
      setScraperEnabled(false);
      await logger.info("services", "Scraper scheduler restored in DISABLED state (from persisted setting)");
    }
  } catch (err) {
    await logger.warn("services", `Failed to load scraper_enabled setting: ${String(err)}`);
  }

  // Restore media ingestion toggle (default OFF — opt-in feature).
  try {
    const persistedMedia = await getSetting("media_enabled");
    if (persistedMedia === "true") {
      setMediaEnabled(true);
      await logger.info("services", "Media ingestion restored in ENABLED state (from persisted setting)");
    }
  } catch (err) {
    await logger.warn("services", `Failed to load media_enabled setting: ${String(err)}`);
  }

  initializeDeduplicationCache()
    .then(() => {
      startDedupCachePersistence();
      startScraperScheduler(scraperInterval);
      logger.info("services", `✅ Scraper started (${scraperInterval / 1000}s intervals) — dedup cache ready`);
      startSourceDiscoveryScheduler(10 * 60 * 1000);
      logger.info("services", "✅ Source discovery started (10 min intervals) — dedup cache ready");
      // Media scheduler ticks every 15 min but no-ops on each tick if the
      // master toggle is off, so it's safe to always start.
      startMediaScheduler(15 * 60 * 1000);
    })
    .catch((err) => {
      logger.warn("services", `Dedup cache init failed — scraper NOT started to avoid storing duplicates: ${String(err)}`);
    });

  // Start memory consolidation (processes conversations hourly)
  startMemoryConsolidation(60 * 60 * 1000);
  await logger.info("services", "✅ Memory consolidation started (hourly)");

  // Start voice learning (updates daily)
  startVoiceLearning(24 * 60 * 60 * 1000);
  await logger.info("services", "✅ Voice learning started (daily)");

  // Start auto-training (runs weekly)
  startAutoTraining(7 * 24 * 60 * 60 * 1000);
  await logger.info("services", "✅ Auto-training started (weekly)");

  // Business-ideas research — reads business-ideas.md, web-searches every
  // idea, generates a markdown brief in reports/business-ideas/, fires a
  // phone notification on completion.
  //
  // Trevor wants this to fire on startup AND every 7 days (his call —
  // "should start researching today on startup then every 7 days").
  // 90s post-boot delay so the server is fully responsive before the
  // long Ollama-pinning run begins.
  const businessIdeasRun = async () => {
    try {
      const { runWeeklyResearch } = await import("./businessIdeas.js");
      const result = await runWeeklyResearch();
      await logger.info(
        "services",
        `Business-ideas research: ${result.researched}/${result.totalIdeas} ideas researched (${result.failed} failed)`,
      );
    } catch (err) {
      await logger.warn("services", `Business-ideas run failed: ${err}`);
    }
  };
  setTimeout(businessIdeasRun, 90_000).unref(); // first run 90s after boot
  setInterval(businessIdeasRun, 7 * 24 * 60 * 60 * 1000).unref(); // every 7 days thereafter
  await logger.info("services", "✅ Business-ideas research scheduled (90s after boot, then weekly)");

  // Load the entity graph from disk (entity-graph.json). Must happen before
  // the backfill and before any chat queries that use the inference engine.
  loadGraph();

  // Build / update entity knowledge graph. This processes all existing chunks
  // through fast NER (pure JavaScript, no LLM) to extract entities and build
  // co-occurrence relationships. First run on 66k chunks takes ~2-3 minutes;
  // subsequent starts are instant (resumes from last checkpoint).
  // Runs in background so it doesn't block server startup.
  backfillEntityGraph()
    .then((result) => {
      if (result.chunksProcessed > 0) {
        logger.info(
          "services",
          `✅ Entity graph built: ${result.entitiesFound.toLocaleString()} entities, ${result.relationshipsBuilt.toLocaleString()} relationships from ${result.chunksProcessed.toLocaleString()} chunks (${(result.durationMs / 1000).toFixed(1)}s)`
        );
      } else {
        logger.info("services", `✅ Entity graph up to date`);
      }
    })
    .catch((err) => {
      logger.warn("services", `Entity graph backfill failed: ${String(err)}`);
    });

  // Run knowledge analysis once shortly after startup (30s delay to let
  // the entity graph finish building), then every 6 hours. Deterministic,
  // no LLM, runs in 2-5 seconds. Findings go to the improvement feed.
  setTimeout(() => {
    analyzeKnowledge().catch((err) =>
      logger.warn("services", `Knowledge analysis failed: ${String(err)}`)
    );
  }, 30_000);
  setInterval(() => {
    analyzeKnowledge().catch((err) =>
      logger.warn("services", `Knowledge analysis failed: ${String(err)}`)
    );
  }, 6 * 60 * 60 * 1000);
  await logger.info("services", "✅ Knowledge analysis scheduled (every 6h)");

  // Start user-defined scheduled tasks (checks every 30s)
  startScheduler();
  await logger.info("services", "✅ Scheduler started (30s tick)");

  // Start integrity checker (runs on startup + every 20 min)
  startIntegrityChecker(20);
  await logger.info("services", "✅ Integrity checker started (every 20min)");

  // Books paused with pauseReason="ollama_down" from a prior run should
  // re-arm the watcher so they auto-resume when Ollama is healthy.
  try {
    const { resumeOllamaPausedBooks } = await import("./bookWriter.js");
    resumeOllamaPausedBooks();
  } catch { /* bookWriter optional */ }

  // Start Unknown Scheduler — daily curiosity-driven knowledge acquisition.
  // Startup check in 90s + hourly elapsed-time checks; fires when >=24h since
  // last run. Survives restart via SQLite-stored lastRun timestamp.
  startUnknownScheduler();
  await logger.info("services", "✅ Unknown Scheduler armed (daily, restart-aware)");

  // PDF / document folder-watch — drop files in ./incoming-pdfs/ and they
  // get auto-ingested into the knowledge base. Moves successes to done/,
  // failures to failed/ with error sidecar. Skips tick during focus mode.
  startPdfWatcher();
  await logger.info("services", "✅ PDF folder-watch armed (drop files in ./incoming-pdfs/)");

  // GitHub repo scraper — pulls README + /docs markdown for a watchlist
  // of repos. SHA-gated so unchanged repos skip entirely. Weekly cycle by
  // default. Manage the watchlist via the `githubRepo` tRPC router.
  startGithubRepoScraper();
  await logger.info("services", "✅ GitHub repo scraper armed (weekly, SHA-gated)");

  // Self-quiz loop — nightly: samples random chunks, LLM generates Q+A
  // from each, JARVIS answers via full RAG pipeline, cloud grader scores
  // the answer. Failed items become corrections that feed next LoRA run.
  startSelfQuiz();
  await logger.info("services", "✅ Self-quiz loop armed (nightly, cloud-graded)");

  // Autonomous loop — fires every 5 min but only acts when the user has
  // toggled autonomy on (off by default). Picks one high-priority learning
  // target or stale goal per tick, capped at 12 actions per day.
  startAutonomousLoop();
  await logger.info("services", "✅ Autonomous loop armed (5-min ticks, toggle-gated)");

  // Keep-awake — on Windows, temporarily override the close-lid action so
  // closing the laptop lid while JARVIS is running doesn't sleep the
  // machine. Original setting is saved and restored on shutdown. No-op on
  // non-Windows platforms.
  await enableKeepAwake();

  // One-shot migration: if the user has analyzed writing samples but
  // no per-category profiles yet (e.g. they uploaded samples before the
  // v15 per-category feature shipped), trigger a regeneration so their
  // book/essay/resume/article/etc. voices get split out automatically.
  // Cheap — pure aggregation over already-analyzed samples, no LLM calls.
  try {
    const { listWritingSamples } = await import("./db.js");
    const { listProfileCategories, regenerateWritingProfile } = await import("./writingProfile.js");
    const samples = await listWritingSamples();
    const analyzedCount = samples.filter((s) => s.styleFeatures).length;
    if (analyzedCount > 0) {
      const profiles = await listProfileCategories();
      const perCategoryCount = profiles.filter((p) => p.category !== "all").length;
      if (perCategoryCount === 0) {
        await logger.info(
          "services",
          `Writing profile migration — ${analyzedCount} analyzed samples but no per-category profiles yet. Regenerating.`
        );
        await regenerateWritingProfile();
        const after = (await listProfileCategories()).filter((p) => p.category !== "all");
        await logger.info(
          "services",
          `✅ Per-category writing profiles generated (${after.length} categories: ${after.map((p) => p.category).join(", ") || "none"})`
        );
      }
    }
  } catch (err) {
    await logger.warn("services", `Writing profile migration skipped: ${String(err)}`);
  }

  // Laptop safety monitor — polls battery and CPU thermal every 30s while
  // the keep-awake override is active. If battery drops below 15% while
  // discharging, or CPU temp exceeds 85°C, triggers a graceful shutdown
  // (which also restores the lid action). Two consecutive breaches
  // required to prevent false positives.
  await startLaptopMonitor();

  // Orphan entity scan — every 2 hours, find entities in the graph with 0
  // co-occurrence connections and feed them to the Unknown Scheduler as
  // learning targets. Startup scan runs 2 minutes after boot to let the
  // entity graph settle. Pure in-memory work, no I/O, takes ~200ms.
  const runOrphanScan = () => {
    try {
      const orphans = scanForOrphanEntities(10);
      if (orphans.length > 0) {
        logger.info("services", `🕵️  Orphan entity scan: flagged ${orphans.length} isolated entities for Unknown Scheduler`).catch(() => {});
      }
    } catch (err) {
      logger.warn("services", `Orphan scan failed: ${err}`).catch(() => {});
    }
  };
  setTimeout(runOrphanScan, 2 * 60_000);
  setInterval(runOrphanScan, 2 * 60 * 60_000);
  await logger.info("services", "✅ Orphan entity scanner armed (every 2h)");

  // Opinion freshness scan — every 24 hours, re-synthesizes non-locked
  // opinions older than 7 days. Refreshes positions with current evidence
  // as the knowledge base grows. User-overrides are NEVER touched.
  // Bounded to 20 opinions per cycle so a backlog can't burn rate limit.
  const runOpinionRefresh = async () => {
    try {
      const { refreshStaleOpinions } = await import("./opinions.js");
      const result = await refreshStaleOpinions({
        maxAgeMs: 7 * 86400_000,
        maxToProcess: 20,
      });
      if (result.checked > 0) {
        await logger.info(
          "services",
          `Opinion refresh: ${result.checked} checked, ${result.refreshed} updated, ${result.unchanged} unchanged, ${result.failed} failed`
        );
      }
    } catch (err) {
      await logger.warn("services", `Opinion refresh failed: ${String(err).slice(0, 200)}`);
    }
  };
  // First run 10 min after boot so initial startup churn is past
  setTimeout(runOpinionRefresh, 10 * 60_000);
  setInterval(runOpinionRefresh, 24 * 60 * 60_000);
  await logger.info("services", "✅ Opinion refresh armed (every 24h, 7-day staleness threshold)");

  // Goal deadline scanner — once on startup (after a short delay so we don't
  // spam at boot) then every 24 hours. Pings the user via phoneNotify when
  // an active goal's deadline is within a week, urgent within 2 days, or
  // overdue. Each invocation is wrapped in try/catch so a notification
  // outage can never crash the service loop.
  const runDeadlineScan = async () => {
    try {
      const alerts = await checkGoalDeadlines();
      if (alerts.length === 0) return;
      const notifyOk = await isNotifyConfigured();
      for (const a of alerts) {
        const dateStr = new Date(a.deadline).toISOString().slice(0, 10);
        const headline = a.severity === "overdue"
          ? `OVERDUE goal: ${a.title}`
          : a.severity === "urgent"
          ? `Goal due in ${a.daysUntil}d: ${a.title}`
          : `Goal deadline approaching: ${a.title}`;
        const body = `Deadline ${dateStr}${a.daysUntil < 0 ? ` (${Math.abs(a.daysUntil)}d ago)` : ` (in ${a.daysUntil}d)`} — goal #${a.goalId}.`;
        await logger.info("goals", `Deadline alert [${a.severity}] goal #${a.goalId}: ${headline}`);
        if (notifyOk) {
          // Use the categorized notify with action buttons (Snooze / Pause /
          // Complete) so the user can act from the lock screen.
          await notifyGoalDeadline({
            goalId: a.goalId,
            title: a.title,
            severity: a.severity,
            daysUntil: a.daysUntil,
            dateStr,
          });
        }
      }
    } catch (err) {
      await logger.warn("goals", `Deadline scan failed: ${String(err)}`);
    }
  };
  setTimeout(() => { runDeadlineScan().catch(() => {}); }, 60_000);
  setInterval(() => { runDeadlineScan().catch(() => {}); }, 24 * 60 * 60 * 1000);
  await logger.info("services", "✅ Goal deadline scanner scheduled (every 24h)");

  // Weekly weakness-topic scrape. Logs the weakest topics from the active
  // learning tables (corrections + confusion events) to the improvement feed
  // so the scraper can be nudged toward them. We don't kick a full discovery
  // run here — that's expensive — the logged topics act as signals the next
  // source-discovery cycle can pick up.
  const weeklyMs = 7 * 24 * 60 * 60 * 1000;
  setInterval(() => {
    import("./activeLearning.js")
      .then((m) =>
        m.scrapeWeakTopics(10).catch((err) =>
          logger.warn("services", `Weekly weakness scrape failed: ${String(err)}`)
        )
      )
      .catch((err) =>
        logger.warn("services", `activeLearning import failed: ${String(err)}`)
      );
  }, weeklyMs);
  await logger.info("services", "✅ Weakness-topic scrape scheduled (weekly)");

  await logger.info("services", "🚀 ALL SYSTEMS ONLINE - JARVIS FULLY ACTIVATED");
}

// Idempotent — adds any DEFAULT_SOURCES whose URL isn't already in the DB.
// Returns the count of NEWLY added sources (not the total). Safe to call
// repeatedly: previously this bailed out if any sources existed, which left
// users stuck with whatever sources they had at first run even after the
// default list grew.
export async function seedDefaultSources(): Promise<{ seeded: number; scraped: boolean }> {
  const existing = await getScrapeSources();
  const existingUrls = new Set(existing.map((s: any) => s.url));

  const missing = DEFAULT_SOURCES.filter(s => !existingUrls.has(s.url));
  if (missing.length === 0) {
    await logger.info("services", `Seed check: all ${DEFAULT_SOURCES.length} default sources already present`);
    return { seeded: 0, scraped: false };
  }

  for (const source of missing) {
    await addScrapeSource(source);
  }
  await logger.info("services", `Seeded ${missing.length} new default sources (${existing.length} already existed)`);

  try {
    await scrapeAllSources();
    return { seeded: missing.length, scraped: true };
  } catch {
    return { seeded: missing.length, scraped: false };
  }
}