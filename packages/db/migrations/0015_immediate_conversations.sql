ALTER TABLE exchanges DROP CONSTRAINT exchanges_when_rule_check;
--> statement-breakpoint
ALTER TABLE exchanges ADD CONSTRAINT exchanges_when_rule_check CHECK (when_rule IN ('tomorrow', 'date', 'whenever', 'now'));
--> statement-breakpoint
ALTER TABLE outbound DROP CONSTRAINT outbound_kind_check;
--> statement-breakpoint
ALTER TABLE outbound ADD CONSTRAINT outbound_kind_check CHECK (kind IN ('conversation', 'arrival', 'repeat', 'turn_prompt', 'answer_receipt', 'answer_post', 'quiet_notice', 'quiet_resolved', 'weekly_read', 'ack', 'nearby_ask', 'flag', 'consent', 'onboarding', 'system'));
