-- Wave in-app notifications (notify on Wave / scheduled Wave-only delivery)
ALTER TYPE public.notification_channel ADD VALUE IF NOT EXISTS 'in_app';
