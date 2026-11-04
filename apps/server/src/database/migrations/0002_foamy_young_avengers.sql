CREATE TABLE `patch_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`diagnosis_id` text NOT NULL,
	`status` text NOT NULL,
	`explanation` text NOT NULL,
	`files_json` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	`approved_at` text,
	`applied_at` text,
	`rejected_at` text,
	`reverted_at` text,
	`application_result` text,
	FOREIGN KEY (`session_id`) REFERENCES `debug_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `diagnoses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `patch_proposals_session_idx` ON `patch_proposals` (`session_id`,`created_at`);