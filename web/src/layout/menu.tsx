import { ReactNode } from "react";
import UserManagementPage from "../pages/Users/UserManagementPage";
import MasterDataPage from "../pages/MasterData/MasterDataPage";
import HomePage from "../pages/Home/HomePage";
import ComingSoonPage from "../pages/ComingSoon/ComingSoonPage";
import PremixAftermixPage from "../pages/PremixAftermix/PremixAftermixPage";
import MillingPage from "../pages/Milling/MillingPage";
import ColourMatchingPage from "../pages/ColourMatching/ColourMatchingPage";
import PackingPage from "../pages/Packing/PackingPage";
import ProductSpekPage from "../pages/ProductSpec/ProductSpekPage";
import CheckResultsPage from "../pages/CheckResults/CheckResultsPage";
import AdminQcPage from "../pages/AdminQc/AdminQcPage";
import ApprovalPage from "../pages/Approval/ApprovalPage";
import ApprovalDashboardPage from "../pages/ApprovalDashboard/ApprovalDashboardPage";
import ProductionOrderDashboardPage from "../pages/ProductionOrderDashboard/ProductionOrderDashboardPage";
import TankDashboardPage from "../pages/TankDashboard/TankDashboardPage";

export interface MenuLeaf {
  type: "leaf";
  label: string;
  path: string;
  element?: ReactNode;
  /** Ditampilkan di halaman "Coming Soon" kalau `element` belum diisi. */
  phaseNote?: string;
}

export interface MenuGroup {
  type: "group";
  label: string;
  children: (MenuGroup | MenuLeaf)[];
  fullAccessOnly?: boolean;
}

export type MenuNode = MenuGroup | MenuLeaf;

function leaf(label: string, path: string, element?: ReactNode, phaseNote?: string): MenuLeaf {
  return { type: "leaf", label, path, element, phaseNote };
}

function group(label: string, children: MenuNode[], fullAccessOnly = false): MenuGroup {
  return { type: "group", label, children, fullAccessOnly };
}

const OUT_OF_SCOPE =
  "Menu ini juga masih berupa placeholder di versi Apps Script sebelumnya (belum pernah diimplementasikan), jadi di luar cakupan migrasi saat ini.";

export const menuTree: MenuNode[] = [
  group("Dashboard", [
    leaf("Production Order Monitoring", "/dashboard/production-order", <ProductionOrderDashboardPage />),
    leaf("Tank Monitoring", "/dashboard/tank", <TankDashboardPage />),
    leaf("Approval", "/dashboard/approval", <ApprovalDashboardPage />),
  ]),
  group("Production & MRP Schedule", [
    leaf("Premix", "/planning/premix", <PremixAftermixPage section="PREMIX" title="Premix" />),
    leaf("Milling", "/planning/milling", <MillingPage />),
    leaf("Aftermix", "/planning/aftermix", <PremixAftermixPage section="AFTERMIX" title="Aftermix" />),
    leaf("Colour Matching", "/planning/colour-matching", <ColourMatchingPage />),
    leaf("Approval", "/planning/approval", <ApprovalPage />),
    leaf("Packing", "/planning/packing", <PackingPage />),
  ]),
  group("Portal Quality Control", [
    leaf("Creating Product Spek", "/qc/product-spec", <ProductSpekPage />),
    leaf("Input Check Results", "/qc/check-results", <CheckResultsPage />),
    leaf("Input Admin QC", "/qc/admin-qc", <AdminQcPage />),
  ]),
  group("Production Label", [
    leaf("Production Label Entry", "/production-label/entry", undefined, OUT_OF_SCOPE),
    leaf("Label History", "/production-label/history", undefined, OUT_OF_SCOPE),
  ]),
  group("Purchase Requisition", [
    leaf("PR Entry", "/pr/entry", undefined, OUT_OF_SCOPE),
    leaf("PR History", "/pr/history", undefined, OUT_OF_SCOPE),
    leaf("PR Monitoring", "/pr/monitoring", undefined, OUT_OF_SCOPE),
  ]),
  group(
    "Developer Tools",
    [
      leaf("User Management", "/admin/users", <UserManagementPage />),
      leaf("Master Data", "/admin/master-data", <MasterDataPage />),
    ],
    true
  ),
];

export const homeRoute = leaf("Beranda", "/", <HomePage />);

export function flattenLeaves(nodes: MenuNode[]): MenuLeaf[] {
  const result: MenuLeaf[] = [];
  for (const node of nodes) {
    if (node.type === "leaf") result.push(node);
    else result.push(...flattenLeaves(node.children));
  }
  return result;
}

export function resolveLeafElement(leafNode: MenuLeaf): ReactNode {
  return leafNode.element ?? <ComingSoonPage label={leafNode.label} note={leafNode.phaseNote} />;
}
