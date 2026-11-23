import { Ctx, canAnywhere } from "../access";
import { withTx } from "../db";
import { displayName } from "./customers";

/**
 * One search box (CV-05, OT-11): plate (any part), mobile (6+ digits), VIN (last 6+), name, job card,
 * invoice and part number. Shared customers and vehicles from all branches; documents from the user's
 * branches only (row security).
 */
export async function globalSearch(ctx: Ctx, raw: string) {
  const q = raw.trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  return withTx(ctx, async (c) => {
    const out: { type: string; label: string; sub: string; href: string }[] = [];
    if (canAnywhere(ctx, "customers", "view")) {
      for (const r of (await c.query(
        `SELECT * FROM customer WHERE active AND (first_name ILIKE $1 OR last_name ILIKE $1 OR company_name ILIKE $1 OR customer_no ILIKE $1 OR ($2 <> '' AND length($2) >= 6 AND mobile LIKE '%'||$2||'%'))
          ORDER BY (customer_no ILIKE $3) DESC, created_at DESC LIMIT 8`, [`%${q}%`, digits, q])).rows)
        out.push({ type: "Customer", label: displayName(r), sub: `${r.customer_no} · ${r.mobile}`, href: `/customers/${r.id}` });
      for (const r of (await c.query(
        `SELECT * FROM vehicle WHERE active AND (plate_number ILIKE $1 OR (registered_in || ' ' || coalesce(plate_code,'') || ' ' || plate_number) ILIKE $1 OR (length($2) >= 6 AND vin LIKE '%'||upper($2)) OR make ILIKE $1 OR model ILIKE $1)
          LIMIT 8`, [`%${q}%`, q.replace(/\s/g, "")])).rows)
        out.push({ type: "Vehicle", label: `${r.registered_in} ${r.plate_code ?? ""} ${r.plate_number}`, sub: `${r.make} ${r.model} ${r.model_year ?? ""} · VIN ${r.vin ?? "n/a"}`, href: `/vehicles/${r.id}` });
    }
    for (const r of (await c.query("SELECT id, doc_no, status FROM job_card WHERE doc_no ILIKE $1 LIMIT 8", [`%${q}%`])).rows)
      out.push({ type: "Job card", label: r.doc_no, sub: r.status, href: `/jobs/${r.id}` });
    if (canAnywhere(ctx, "invoices", "view"))
      for (const r of (await c.query("SELECT id, doc_no, bill_to_name FROM sales_invoice WHERE doc_no ILIKE $1 LIMIT 8", [`%${q}%`])).rows)
        out.push({ type: "Invoice", label: r.doc_no, sub: r.bill_to_name, href: `/invoices/${r.id}` });
    if (canAnywhere(ctx, "stock", "view") || canAnywhere(ctx, "jobs", "view"))
      for (const r of (await c.query(`SELECT id, part_no, description, oem_part_no, (upper(btrim(barcode)) = upper($2)) by_barcode FROM item WHERE active
          AND (part_no ILIKE $1 OR description ILIKE $1 OR search_codes LIKE '%'||upper($2)||'%' OR fits_vehicles ILIKE $1)
        ORDER BY (upper(btrim(barcode)) = upper($2)) DESC NULLS LAST, part_no LIMIT 8`, [`%${q}%`, q.trim()])).rows)
        out.push({ type: "Part", label: r.part_no, sub: [r.description, r.oem_part_no && `OEM ${r.oem_part_no}`].filter(Boolean).join(" · "), href: `/stock?q=${encodeURIComponent(r.part_no)}` });
    if ((canAnywhere(ctx, "stock", "view") || canAnywhere(ctx, "jobs", "view")) && q.length >= 3)
      for (const r of (await c.query(`SELECT ps.serial_no, ps.warranty_until, ps.warranty_until >= current_date ok, i.part_no, j.id job_id, j.doc_no FROM part_serial ps
          JOIN item i ON i.id = ps.item_id LEFT JOIN job_card j ON j.id = ps.job_card_id WHERE upper(ps.serial_no) LIKE upper($1) || '%' LIMIT 8`, [q])).rows)
        out.push({ type: "Serial", label: r.serial_no, sub: `${r.part_no} · ${r.doc_no ?? ""} · ${r.warranty_until ? (r.ok ? `under warranty to ${new Date(r.warranty_until).toISOString().slice(0, 10)}` : "warranty ended") : "no warranty"}`, href: `/stock/tyres?serial=${encodeURIComponent(r.serial_no)}` });
    return out;
  });
}
