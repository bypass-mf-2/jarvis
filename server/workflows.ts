// server/workflows.ts
interface Workflow {
  steps: Array<{
    type: "search" | "scrape" | "analyze" | "write";
    input: string;
    output: string;
  }>;
}

// Example: "Research topic → Scrape sources → Write report"