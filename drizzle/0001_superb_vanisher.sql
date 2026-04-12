CREATE TABLE `conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`title` varchar(255) DEFAULT 'New Conversation',
	`model` varchar(128) DEFAULT 'llama3.2',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceUrl` varchar(1024),
	`sourceTitle` varchar(512),
	`sourceType` enum('rss','news','custom_url','manual') DEFAULT 'custom_url',
	`content` text NOT NULL,
	`summary` text,
	`chromaId` varchar(128),
	`embeddingModel` varchar(128) DEFAULT 'nomic-embed-text',
	`tags` json,
	`scrapedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `knowledge_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`audioUrl` varchar(512),
	`tokensUsed` int,
	`ragChunksUsed` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scrape_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`type` enum('rss','news','custom_url') NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`intervalMinutes` int DEFAULT 60,
	`lastScrapedAt` timestamp,
	`lastStatus` enum('success','error','pending') DEFAULT 'pending',
	`lastError` text,
	`totalChunks` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scrape_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `self_improvement_patches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`analysisInput` text,
	`suggestion` text NOT NULL,
	`patchDiff` text,
	`targetFile` varchar(512),
	`status` enum('pending','approved','applied','rejected') DEFAULT 'pending',
	`appliedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `self_improvement_patches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`level` enum('info','warn','error','debug') DEFAULT 'info',
	`module` varchar(128),
	`message` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `system_logs_id` PRIMARY KEY(`id`)
);
