CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
