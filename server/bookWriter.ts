/**
 * Book Writing System
 * 
 * Helps Trevor write a book in his voice
 * Maintains consistency across chapters
 */

import { writeInTrevorsVoice, getVoiceSystemPrompt } from "./voiceLearning.js";
import { ollamaChat } from "./ollama.js";
import * as fs from "fs";

interface Chapter {
  number: number;
  title: string;
  outline: string;
  content: string;
  wordCount: number;
  status: "outlined" | "drafted" | "revised" | "final";
}

interface Book {
  title: string;
  author: string;
  genre: string;
  targetWordCount: number;
  outline: string;
  chapters: Chapter[];
}

// Create book outline
export async function createBookOutline(
  title: string,
  concept: string,
  numChapters: number
): Promise<Book> {
  const prompt = `Create a detailed outline for a book:

Title: ${title}
Concept: ${concept}
Number of chapters: ${numChapters}

Return as JSON:
{
  "genre": "...",
  "outline": "Overall book description and arc",
  "chapters": [
    {"number": 1, "title": "...", "outline": "What happens in this chapter"}
  ]
}`;

  const response = await ollamaChat([{ role: "user", content: prompt }]);
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  
  if (!jsonMatch) throw new Error("Failed to generate outline");
  
  const outline = JSON.parse(jsonMatch[0]);
  
  return {
    title,
    author: "Trevor",
    genre: outline.genre,
    targetWordCount: numChapters * 3000, // ~3k words per chapter
    outline: outline.outline,
    chapters: outline.chapters.map((ch: any) => ({
      ...ch,
      content: "",
      wordCount: 0,
      status: "outlined",
    })),
  };
}

// Write a chapter in Trevor's voice
export async function writeChapter(
  book: Book,
  chapterNumber: number
): Promise<string> {
  const chapter = book.chapters.find(ch => ch.number === chapterNumber);
  if (!chapter) throw new Error("Chapter not found");
  
  const systemPrompt = getVoiceSystemPrompt(`
Write Chapter ${chapter.number}: "${chapter.title}"

Book: ${book.title}
Genre: ${book.genre}
Previous chapters summary: ${
    book.chapters
      .filter(ch => ch.number < chapterNumber && ch.status !== "outlined")
      .map(ch => `Ch${ch.number}: ${ch.title}`)
      .join(", ")
  }

Chapter outline: ${chapter.outline}

Write approximately 3000 words. Maintain narrative consistency with previous chapters.
Write in Trevor's voice - use his style, phrases, and perspective.
  `);
  
  const content = await ollamaChat([
    { role: "system", content: systemPrompt },
    { role: "user", content: `Write chapter ${chapter.number}: ${chapter.title}` },
  ], "llama3.1:70b"); // Use larger model for better quality
  
  chapter.content = content;
  chapter.wordCount = content.split(/\s+/).length;
  chapter.status = "drafted";
  
  // Save book progress
  fs.writeFileSync("book-progress.json", JSON.stringify(book, null, 2));
  
  return content;
}

// Review and revise chapter
export async function reviseChapter(
  chapter: Chapter,
  feedback: string
): Promise<string> {
  const prompt = `Revise this chapter based on feedback:

ORIGINAL:
${chapter.content}

FEEDBACK:
${feedback}

Write the revised version in Trevor's voice.`;

  const revised = await ollamaChat([
    { role: "user", content: prompt }
  ]);
  
  chapter.content = revised;
  chapter.status = "revised";
  
  return revised;
}