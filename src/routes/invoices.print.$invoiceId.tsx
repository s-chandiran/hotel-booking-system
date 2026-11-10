import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { invoiceDetailQuery } from "@/api/actions.api";
import { inr } from "@/components/app/DataTable";

export const Route = createFileRoute("/invoices/print/$invoiceId")({
  head: () => ({
    meta: [{ title: "Print invoice — StayDesk" }],
  }),
  component: PrintInvoicePage,
});

/**
 * Authorized print document for Electron `printInvoice({ invoiceId })`.
 * Loads invoice via BFF session; marks window ready for the main process print dialog.
 */
function PrintInvoicePage() {
  const { invoiceId } = Route.useParams();
  const q = useQuery(invoiceDetailQuery(invoiceId));

  useEffect(() => {
    if (q.data) {
      (window as Window & { __staydeskPrintReady?: boolean }).__staydeskPrintReady = true;
    }
  }, [q.data]);

  if (q.isLoading) return <p style={{ fontFamily: "Segoe UI, sans-serif", padding: 24 }}>Loading invoice…</p>;
  if (q.error || !q.data) {
    return (
      <p style={{ fontFamily: "Segoe UI, sans-serif", padding: 24, color: "#b91c1c" }}>
        Invoice could not be loaded. Check that you are signed in.
      </p>
    );
  }

  const d = q.data;
  const amountPaid = d.amountPaid ?? Math.max(0, d.amount - d.balanceDue);

  return (
    <div style={{ fontFamily: "Segoe UI, sans-serif", color: "#0f172a", padding: "24mm 18mm", maxWidth: "210mm", margin: "0 auto" }}>
      <header style={{ marginBottom: 24, borderBottom: "2px solid #0f172a", paddingBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>StayDesk Invoice</h1>
        <p style={{ margin: "8px 0 0", fontSize: 14 }}>{d.number}</p>
      </header>
      <p style={{ fontSize: 14, lineHeight: 1.5 }}>
        Guest: <strong>{d.guestName}</strong>
        <br />
        Booking: {d.reference}
        <br />
        Issued: {d.issued}
        <br />
        Type: {d.type === "penalty" ? "Penalty" : "Stay"}
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 20, fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1", padding: "6px 0" }}>Description</th>
            <th style={{ textAlign: "right", borderBottom: "1px solid #cbd5e1", padding: "6px 0" }}>Qty</th>
            <th style={{ textAlign: "right", borderBottom: "1px solid #cbd5e1", padding: "6px 0" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.lineNo}>
              <td style={{ padding: "6px 0" }}>{l.description}</td>
              <td style={{ textAlign: "right" }}>{l.quantity}</td>
              <td style={{ textAlign: "right" }}>{inr(l.lineNet)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.taxLines.length ? (
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <strong>Tax snapshot</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {d.taxLines.map((t) => (
              <li key={t.code}>
                {t.name} ({t.ratePercent}%): {inr(t.taxAmount)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div style={{ marginTop: 24, fontSize: 14, lineHeight: 1.6 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Net</span>
          <span>{inr(d.net)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Tax</span>
          <span>{inr(d.tax)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
          <span>Total</span>
          <span>{inr(d.amount)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Amount paid</span>
          <span>{d.documentStatus === "void" ? "—" : inr(amountPaid)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
          <span>Balance due</span>
          <span>{d.documentStatus === "void" ? "—" : inr(d.balanceDue)}</span>
        </div>
        <p style={{ marginTop: 12 }}>Status: {d.status}</p>
      </div>
    </div>
  );
}
