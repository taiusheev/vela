CREATE INDEX "memory_facts_family_idx" ON "memory_facts" USING btree ("family_id","on_date");--> statement-breakpoint
CREATE INDEX "memory_facts_answer_idx" ON "memory_facts" USING btree ("source_answer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_one_per_fact" ON "reminders" USING btree ("member_id","fact_id");--> statement-breakpoint
CREATE INDEX "reminders_member_idx" ON "reminders" USING btree ("member_id","due_date");