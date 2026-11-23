import type { ReactNode } from "react";
import { PT, type PrintLang } from "@/lib/print-text";
import type { PrintSetup } from "@/lib/services/print";

type Key = keyof typeof PT;

/** A fixed label in the chosen print language: English, Arabic, or both (English with Arabic under it). */
export function Bi({ k, lang, inline }: { k: Key; lang: PrintLang; inline?: boolean }) {
  const [en, ar] = PT[k];
  if (lang === "en") return <>{en}</>;
  if (lang === "ar") return <span dir="rtl" lang="ar">{ar}</span>;
  return inline ? <>{en} <span className="ar" dir="rtl" lang="ar">{ar}</span></> : <span className="bi">{en}<span className="ar" dir="rtl" lang="ar">{ar}</span></span>;
}

/** A line description with its Arabic name, as the language allows. */
export function BiText({ en, ar, lang }: { en: string; ar?: string | null; lang: PrintLang }) {
  if (!ar || lang === "en") return <>{en}</>;
  if (lang === "ar") return <span dir="rtl" lang="ar">{ar}</span>;
  return <>{en}<div className="ar small" dir="rtl" lang="ar">{ar}</div></>;
}

/** Letterhead, title and document details shared by every printed document (OT-08). */
export function PrintHead({ s, title, meta, logo = true }: { s: PrintSetup; title: Key; meta: ReactNode; logo?: boolean }) {
  const { lang } = s;
  return (
    <div className="printhead">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo && <img src="/sflogo.png" alt="Superfix" width={86} height={46} />}
        {lang !== "ar" && <div><b>{s.company.name_en}</b></div>}
        {lang !== "en" && <div dir="rtl" lang="ar"><b>{s.company.name_ar}</b></div>}
        <div className="small">{lang === "ar" && s.branch.name_ar ? <span dir="rtl" lang="ar">فرع {s.branch.name_ar}</span> : <>{s.branch.name_en} branch{lang === "both" && s.branch.name_ar ? <> · <span dir="rtl" lang="ar">فرع {s.branch.name_ar}</span></> : null}</>}
          {s.branch.address ? `, ${s.branch.address}` : ""}, {s.branch.emirate}{s.branch.phone ? ` · ${s.branch.phone}` : ""}</div>
        <div className="small"><Bi k="trn" lang={lang} inline /> {s.company.trn}</div>
      </div>
      <div className="printtitle">
        <h1 style={{ margin: 0 }}>{lang === "ar" ? <span dir="rtl" lang="ar">{PT[title][1]}</span> : PT[title][0]}</h1>
        {lang === "both" && <div className="ar" dir="rtl" lang="ar" style={{ fontSize: 17 }}>{PT[title][1]}</div>}
        {meta}
      </div>
    </div>
  );
}

/** The terms the admin set for this kind of document, in the print language. */
export function PrintTerms({ s }: { s: PrintSetup }) {
  const { en, ar } = s.terms;
  if (!en && !ar) return null;
  return (
    <div className="printterms small">
      {s.lang !== "ar" && en && <div>{en}</div>}
      {s.lang !== "en" && ar && <div dir="rtl" lang="ar">{ar}</div>}
    </div>
  );
}

/** Signature lines at the foot of a document. */
export function PrintSign({ lang, left = "customerSignature", right = "forCompany", leftImage }: { lang: PrintLang; left?: Key; right?: Key; leftImage?: string | null }) {
  return (
    <div className="printsign">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div>{leftImage ? <img src={leftImage} alt="" height={60} /> : <div style={{ height: 60 }} />}<div className="line"><Bi k={left} lang={lang} inline /></div></div>
      <div><div style={{ height: 60 }} /><div className="line"><Bi k={right} lang={lang} inline /></div></div>
    </div>
  );
}

/** Wraps a printed document so an Arabic-only layout reads right to left. */
export function PrintPage({ lang, children, className = "" }: { lang: PrintLang; children: ReactNode; className?: string }) {
  return <div className={`card printdoc ${className}`} dir={lang === "ar" ? "rtl" : "ltr"} lang={lang === "ar" ? "ar" : "en"}>{children}</div>;
}
