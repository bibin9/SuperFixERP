-- A customer may answer a quotation by typing a reply in WhatsApp instead of using the approval link.
-- Messaging is manual, so the advisor records that answer; like a phone answer it needs a note.
ALTER TABLE quotation_line DROP CONSTRAINT quotation_line_decision_channel_check;
ALTER TABLE quotation_line ADD CONSTRAINT quotation_line_decision_channel_check
  CHECK (decision_channel IN ('whatsapp_link','whatsapp_reply','in_person','phone','email'));
ALTER TABLE quotation_line DROP CONSTRAINT quotation_line_check;
ALTER TABLE quotation_line ADD CONSTRAINT quotation_line_check
  CHECK (decision_channel IS NULL OR decision_channel NOT IN ('phone','whatsapp_reply') OR decision_note IS NOT NULL);

-- Clearer approval message: the link, or a typed YES. Only replaces the text if the admin has not edited it.
UPDATE message_template SET body = 'Dear {title} {name}, your quotation {doc_no} for {plate} at Superfix {branch} is ready. Total AED {amount} incl. VAT. Tap this link to see each item and approve or decline it: {link} Or reply YES to approve everything. We start work only after your approval.' WHERE event = 'quotation_for_approval' AND language = 'en' AND body = 'Dear {title} {name}, your quotation {doc_no} for {plate} at Superfix {branch} is ready. Total AED {amount} incl. VAT. Please review and approve here: {link}';
UPDATE message_template SET body = 'عزيزي {title} {name}، عرض السعر {doc_no} لسيارتك {plate} جاهز. الإجمالي {amount} درهم شامل الضريبة. اضغط على الرابط لمراجعة كل بند والموافقة عليه أو رفضه: {link} أو أرسل نعم للموافقة على الكل. نبدأ العمل فقط بعد موافقتك.' WHERE event = 'quotation_for_approval' AND language = 'ar' AND body = 'عزيزي {title} {name}، عرض السعر {doc_no} لسيارتك {plate} جاهز. الإجمالي {amount} درهم شامل الضريبة. للموافقة: {link}';
