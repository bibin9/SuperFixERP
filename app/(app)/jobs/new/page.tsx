import { redirect } from "next/navigation";

/** Job cards are created only from an approved quotation (FSD v0.10), on the enquiry. */
export default function NewJob() {
  redirect("/enquiries?status=approved");
}
