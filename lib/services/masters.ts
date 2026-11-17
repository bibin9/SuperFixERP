import { Ctx } from "../access";
import { withTx } from "../db";

/** Pick lists for forms. Masters are shared data (no branch scope). */
export async function masters(ctx: Ctx) {
  return withTx(ctx, async (c) => ({
    countries: (await c.query("SELECT code, name, id_types FROM country ORDER BY name")).rows,
    titles: (await c.query("SELECT code, name_en FROM customer_title WHERE active ORDER BY name_en")).rows,
    plates: (await c.query("SELECT code, name, code_label, code_values FROM plate_template WHERE active ORDER BY country_code <> 'AE', name")).rows,
    services: (await c.query("SELECT id, code, name_en, standard_hours, labour_rate, is_quick FROM service WHERE active ORDER BY name_en")).rows,
    items: (await c.query("SELECT id, part_no, description, list_price, category, item_type FROM item WHERE active ORDER BY part_no")).rows,
    branches: (await c.query("SELECT id, code, name_en FROM branch WHERE active ORDER BY code")).rows,
    suppliers: (await c.query("SELECT id, code, name_en FROM supplier WHERE active ORDER BY name_en")).rows,
    taxCodes: (await c.query("SELECT code, name FROM tax_code WHERE active ORDER BY code")).rows,
    bays: ctx.currentBranchId ? (await c.query("SELECT id, code FROM bay WHERE branch_id = $1 AND active ORDER BY code", [ctx.currentBranchId])).rows : [],
    paymentMethods: (await c.query("SELECT code, name, needs_reference FROM payment_method WHERE active ORDER BY sort, name")).rows,
    lookups: (await c.query("SELECT list, code, name_en FROM lookup_value WHERE active ORDER BY list, sort")).rows,
    technicians: ctx.currentBranchId ? (await c.query(
      "SELECT u.id, u.full_name FROM user_branch_role ubr JOIN app_user u ON u.id = ubr.user_id JOIN role r ON r.id = ubr.role_id WHERE r.code = 'technician' AND ubr.branch_id = $1 AND u.status = 'active' ORDER BY u.full_name",
      [ctx.currentBranchId])).rows : [],
  }));
}
