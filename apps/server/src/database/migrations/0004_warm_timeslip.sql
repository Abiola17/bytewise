CREATE TABLE `screenshots` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`phrase` text NOT NULL,
	`file_name` text,
	`mime_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`regions_json` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `debug_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `screenshots_session_idx` ON `screenshots` (`session_id`,`created_at`);