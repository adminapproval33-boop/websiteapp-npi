import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { formatDateTime } from "../../lib/datetime";
import { fitPrintPageToOneA4 } from "../../lib/printFit";
import "../../styles/print.css";

interface ParamRow {
  no: number;
  parameter: string;
  standard: string | null;
  result: string | null;
  remark: string | null;
  start: string | null;
  finish: string | null;
}

interface CheckDetail {
  checkId: string;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  checkNotes: string | null;
  parameters: ParamRow[];
}

export default function PrintCoaPage() {
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
        <h1>Certificate of Analysis (COA)</h1>
        <p style={{ textAlign: "center", fontSize: 10, marginTop: -4 }}>Dicetak: {formatDateTime(new Date())}</p>

        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Material Number</th>
              <th>Material Description</th>
              <th>Batch</th>
              <th>Parameter</th>
              <th>Standard</th>
              <th>Result</th>
              <th>Remark</th>
              <th>Start</th>
              <th>Finish</th>
            </tr>
          </thead>
          <tbody>
            {data.parameters.map((p) => (
              <tr key={p.no}>
                <td>{data.order}</td>
                <td>{data.materialNumber}</td>
                <td>{data.materialDescription}</td>
                <td>{data.batch}</td>
                <td>{p.parameter}</td>
                <td>{p.standard}</td>
                <td>{p.result}</td>
                <td>{p.remark}</td>
                <td>{formatDateTime(p.start)}</td>
                <td>{formatDateTime(p.finish)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {data.checkNotes && (
          <>
            <div className="section-title">Check Notes</div>
            <p>{data.checkNotes}</p>
          </>
        )}
      </div>
    </div>
  );
}
