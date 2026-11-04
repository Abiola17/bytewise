CREATE TABLE `verification_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`patch_id` text,
	`script` text NOT NULL,
	`command_label` text NOT NULL,
	`status` text NOT NULL,
	`exit_code` integer,
	`signal` text,
	`stdout` text NOT NULL,
	`stderr` text NOT NULL,
	`output_truncated` integer NOT NULL,
	`error_message` text,
	`duration_ms` integer,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `debug_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`patch_id`) REFERENCES `patch_proposals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `verification_runs_session_idx` ON `verification_runs` (`session_id`,`started_at`);