PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`status` text NOT NULL,
	`started_on` text,
	`finished_on` text,
	`rating` integer,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "readings_status_check" CHECK("__new_readings"."status" IN ('want', 'reading', 'done', 'abandoned')),
	CONSTRAINT "readings_rating_check" CHECK("__new_readings"."rating" IS NULL OR "__new_readings"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
INSERT INTO `__new_readings`("id", "book_id", "status", "started_on", "finished_on", "rating", "note", "created_at", "updated_at") SELECT "id", "book_id", "status", "started_on", "finished_on", "rating", "note", "created_at", "updated_at" FROM `readings`;--> statement-breakpoint
DROP TABLE `readings`;--> statement-breakpoint
ALTER TABLE `__new_readings` RENAME TO `readings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `readings_book_id_idx` ON `readings` (`book_id`);