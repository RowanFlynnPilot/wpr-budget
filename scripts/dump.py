import pdfplumber
pdf = pdfplumber.open("2026-Annual-Budget.pdf")
out = []
for i, p in enumerate(pdf.pages):
    t = p.extract_text() or ""
    if "AVERAGE HOMEOWNER IMPACT" in t or "TAX LEVY VS" in t or "Historical Tax Rate" in t:
        out.append("=== PDF PAGE " + str(i) + " ===\n" + t)
open("dump3.txt", "w", encoding="utf-8").write("\n\n".join(out))
print("wrote dump3.txt with", len(out), "pages")
