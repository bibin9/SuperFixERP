-- 037 OT-08: print layouts in English and Arabic. The admin chooses the language of printed documents
-- and the terms printed at the foot of each one (Settings, Printing). Branch settings can override.
INSERT INTO setting (key, value, grp, description)
SELECT v.key, to_jsonb(v.val), 'Printing', v.description
  FROM (VALUES
    ('print.language', 'both', 'Language of printed documents: both (English and Arabic side by side), en or ar'),
    ('print.terms_invoice_en', 'Goods once fitted are covered by the maker''s warranty only. Please check your vehicle before leaving the branch.', 'Terms at the foot of the tax invoice (English)'),
    ('print.terms_invoice_ar', 'القطع المركبة مشمولة بضمان الشركة المصنعة فقط. يرجى فحص سيارتك قبل مغادرة الفرع.', 'Terms at the foot of the tax invoice (Arabic)'),
    ('print.terms_quotation_en', 'Prices include 5% VAT and are valid until the date shown. Extra work found during the job is quoted before it is done.', 'Terms at the foot of the quotation (English)'),
    ('print.terms_quotation_ar', 'الأسعار شاملة ضريبة القيمة المضافة 5% وصالحة حتى التاريخ المذكور. أي عمل إضافي يتم تسعيره قبل تنفيذه.', 'Terms at the foot of the quotation (Arabic)'),
    ('print.terms_job_card_en', 'I authorise the work listed above. Superfix is not responsible for valuables left in the vehicle. Vehicles not collected within 3 days of completion may be charged parking.', 'Terms at the foot of the job card (English)'),
    ('print.terms_job_card_ar', 'أوافق على تنفيذ الأعمال المذكورة أعلاه. سوبر فكس غير مسؤولة عن المقتنيات الثمينة المتروكة في السيارة. قد تُفرض رسوم مواقف على السيارات التي لا تُستلم خلال 3 أيام من الانتهاء.', 'Terms at the foot of the job card (Arabic)'),
    ('print.terms_receipt_en', 'Thank you for your payment. Cheques are subject to clearance.', 'Terms at the foot of the receipt (English)'),
    ('print.terms_receipt_ar', 'شكراً لدفعكم. الشيكات خاضعة للتحصيل.', 'Terms at the foot of the receipt (Arabic)')
  ) v(key, val, description)
 WHERE NOT EXISTS (SELECT 1 FROM setting s WHERE s.key = v.key AND s.branch_id IS NULL);
