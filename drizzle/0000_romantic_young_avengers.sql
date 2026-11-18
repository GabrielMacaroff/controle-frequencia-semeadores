CREATE TABLE `calls` (
	`encounter_id` text PRIMARY KEY NOT NULL,
	`marks` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`display` text NOT NULL,
	`expires_at` integer NOT NULL
);
