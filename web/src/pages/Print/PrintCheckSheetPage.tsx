import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { fitPrintPageToOneA4 } from "../../lib/printFit";
import { COMPANY_LOGO_DATA_URI } from "../../lib/companyLogo";
import "../../styles/print.css";

interface ParamRow {
  no: number;
  parameter: string;
  standard: string | null;
  result: string | null;
  start: string | null;
  finish: string | null;
  pic: string | null;
}

interface CheckDetail {
  checkId: string;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  lotCoa: string | null;
  codeTanki: string | null;
  customer: string | null;
  appearanceNotes: string | null;
  specInformation: string | null;
  inputBy: string;
  parameters: ParamRow[];
}

export default function PrintCheckSheetPage() {
  const { checkId } = useParams();
  const [data, setData] = useState<CheckDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!checkId) return;
    api
      .get<{ success: boolean; data: CheckDetail }>(`/check-results/${checkId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Gagal memuat data."));
  }, [checkId]);

  useEffect(() => {
    if (data) {
      const timeout = setTimeout(() => {
        fitPrintPageToOneA4();
        window.print();
      }, 400);
      return () => clearTimeout(timeout);
    }
  }, [data]);

  if (error) return <p style={{ padding: 20 }}>{error}</p>;
  if (!data) return <p style={{ padding: 20 }}>Memuat...</p>;

  return (
    <div>
      <div className="print-toolbar">
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <div className="print-page">
        <div className="doc-header">
          <img src={COMPANY_LOGO_DATA_URI} alt="Logo" className="doc-logo" />
          <h1>CHECK SHEET QUALITY CONTROL</h1>
          <div className="doc-code">Doc No. F-D TQP-FI-011</div>
        </div>

        <table>
          <tbody>
            <tr>
              <th style={{ width: "16%" }}>Order</th>
              <td>{data.order}</td>
              <th style={{ width: "16%" }}>Batch</th>
              <td>{data.batch}</td>
            </tr>
            <tr>
              <th>Material Number</th>
              <td>{data.materialNumber}</td>
              <th>Material Description</th>
              <td>{data.materialDescription}</td>
            </tr>
            <tr>
              <th>Order Qty</th>
              <td>{data.orderQty}</td>
              <th>Plant</th>
              <td>{data.plant}</td>
            </tr>
            <tr>
              <th>Lot COA</th>
              <td>{data.lotCoa}</td>
              <th>Code Tanki</th>
              <td>{data.codeTanki}</td>
            </tr>
            <tr>
              <th>Customer</th>
              <td colSpan={3}>{data.customer}</td>
            </tr>
          </tbody>
        </table>

        <div className="section-title">Spec Parameters</div>
        <table>
          <thead>
            <tr>
              <th style={{ width: "6%" }}>No</th>
              <th style={{ width: "40%" }}>Item Check</th>
              <th style={{ width: "18%" }}>Spec</th>
              <th style={{ width: "18%" }}>Result</th>
              <th style={{ width: "18%" }}>PIC</th>
            </tr>
          </thead>
          <tbody>
            {data.parameters.map((p) => (
              <tr key={p.no}>
                <td>{p.no}</td>
                <td>{p.parameter}</td>
                <td>{p.standard}</td>
                <td>{p.result}</td>
                <td>{p.pic}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="section-title">Appearance Check Results</div>
        <p>{data.appearanceNotes || "-"}</p>

        <div className="section-title">Information</div>
        <p>{data.specInformation || "-"}</p>

        <div className="signature-block">
          <div className="signature-box">
            <div className="signature-label">Signature</div>
            <div className="signature-line">&nbsp;</div>
          </div>
        </div>
      </div>
    </div>
  );
}
