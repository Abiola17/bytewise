CREATE TABLE `debug_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `debug_sessions_project_idx` ON `debug_sessions` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`likely_cause` text,
	`confidence` text,
	`uncertainty` text,
	`suggested_fix` text,
	`limitations_json` text NOT NULL,
	`clarifying_questions_json` text NOT NULL,
	`evidence_ids_json` text NOT NULL,
	`rejected_evidence_ids_json` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `debug_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diagnoses_session_idx` ON `diagnoses` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`source_type` text NOT NULL,
	`relative_path` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`excerpt` text NOT NULL,
	`description` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `id`),
	FOREIGN KEY (`session_id`) REFERENCES `debug_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`diagnosis_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `debug_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_session_idx` ON `messages` (`session_id`,`created_at`);