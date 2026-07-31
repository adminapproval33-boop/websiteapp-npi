import OpenApprovalWorklist from "./OpenApprovalWorklist";

export default function ApprovalDashboardPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel">
        <div className="panel-body">
          <OpenApprovalWorklist />
        </div>
      </div>
    </div>
  );
}
