-- 018 "Send new time": when a job runs late the advisor sets a new promised time with a reason and
-- sends the customer a WhatsApp message with it (prepared text, sent by staff, as for other messages).
INSERT INTO message_template (event, language, body)
SELECT 'new_time', 'en', 'Dear {title} {name}, an update on {plate} (job {job_no}) at Superfix {branch}: the work needs more time ({reason}). Your car will now be ready by {promised}. Sorry for the wait, and thank you for your patience.'
WHERE NOT EXISTS (SELECT 1 FROM message_template WHERE event = 'new_time' AND language = 'en');
INSERT INTO message_template (event, language, body)
SELECT 'new_time', 'ar', 'عزيزي {title} {name}، تحديث بخصوص سيارتك {plate} (أمر العمل {job_no}) في سوبرفكس {branch}: العمل يحتاج وقتاً إضافياً ({reason}). ستكون سيارتك جاهزة الآن بحلول {promised}. نعتذر عن الانتظار ونشكرك على صبرك.'
WHERE NOT EXISTS (SELECT 1 FROM message_template WHERE event = 'new_time' AND language = 'ar');
