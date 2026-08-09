import { ReactNode } from "react";
import { StoredSession } from "../api/client";
import { MENU_KEY_BY_PATH, getMenuLevel } from "../lib/menuAccess";
import UserManagementPage from "../pages/Users/UserManagementPage";
import MasterDataPage from "../pages/MasterData/MasterDataPage";
import HomePage from "../pages/Home/HomePage";
import ComingSoonPage from "../pages/ComingSoon/ComingSoonPage";
import PremixAftermixPage from "../pages/PremixAftermix/PremixAftermixPage";
import MillingPage from "../pages/Milling/MillingPage";
import ColourMatchingPage from "../pages/ColourMatching/ColourMatchingPage";
import BongkaranPage from "../pages/Bongkaran/BongkaranPage";
import PackingPage from "../pages/Packing/PackingPage";
import ProductSpekPage from "../pages/ProductSpec/ProductSpekPage";
import CheckResultsPage from "../pages/CheckResults/CheckResultsPage";
import AdminQcPage from "../pages/AdminQc/AdminQcPage";
import ApprovalPage from "../pages/Approval/ApprovalPage";
import ApprovalDashboardPage from "../pages/ApprovalDashboard/ApprovalDashboardPage";
import ProductionOrderDashboardPage from "../pages/ProductionOrderDashboard/ProductionOrderDashboardPage";
import TankDashboardPage from "../pages/TankDashboard/TankDashboardPage";
import ProduktivitasDashboardPage from "../pages/ProduktivitasDashboard/ProduktivitasDashboardPage";
import MesinDashboardPage from "../pages/MesinDashboard/MesinDashboardPage";
import QualityCheckReviewPage from "../pages/QualityCheckReview/QualityCheckReviewPage";
import ProductionLabelEntryPage from "../pages/ProductionLabel/ProductionLabelEntryPage";
import LabelHistoryPage from "../pages/ProductionLabel/LabelHistoryPage";
import MaintenanceFormPage from "../pages/Maintenance/MaintenanceFormPage";
import MaintenanceListPage from "../pages/Maintenance/MaintenanceListPage";
import MaintenanceSchedulePage from "../pages/Maintenance/MaintenanceSchedulePage";

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
    leaf("Dashboard Produktivitas", "/dashboard/produktivitas", <ProduktivitasDashboardPage />),
    leaf("Dashboard Approval", "/dashboard/approval", <ApprovalDashboardPage />),
    leaf("Production Order Monitoring", "/dashboard/production-order", <ProductionOrderDashboardPage />),
    leaf("Tank Monitoring", "/dashboard/tank", <TankDashboardPage />),
    leaf("Mesin Monitoring", "/dashboard/mesin", <MesinDashboardPage />),
    leaf("Quality Check Review", "/dashboard/quality-check-review", <QualityCheckReviewPage />),
  ]),
  group("Production & MRP Schedule", [
    leaf("Premix", "/planning/premix", <PremixAftermixPage section="PREMIX" title="Premix" />),
    leaf("Milling", "/planning/milling", <MillingPage />),
    leaf("Aftermix", "/planning/aftermix", <PremixAftermixPage section="AFTERMIX" title="Aftermix" />),
    leaf("Colour Matching", "/planning/colour-matching", <ColourMatchingPage />),
    leaf("Bongkaran", "/planning/bongkaran", <BongkaranPage />),
    leaf("Approval", "/planning/approval", <ApprovalPage />),
    leaf("Packing", "/planning/packing", <PackingPage />),
  ]),
  group("Portal Quality Control", [
    leaf("Creating Product Spek", "/qc/product-spec", <ProductSpekPage />),
    leaf("Input Check Results", "/qc/check-results", <CheckResultsPage />),
    leaf("Input Admin QC", "/qc/admin-qc", <AdminQcPage />),
  ]),
  group("Production Label", [
    leaf("Production Label Entry", "/production-label/entry", <ProductionLabelEntryPage />),
    leaf("Label History", "/production-label/history", <LabelHistoryPage />),
  ]),
  group("Maintenance", [
    leaf("Form Input Maintenance", "/maintenance/form", <MaintenanceFormPage />),
    leaf("List Job Maintenance", "/maintenance/list", <MaintenanceListPage />),
    leaf("Jadwal Pengerjaan", "/maintenance/schedule", <MaintenanceSchedulePage />),
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

/** Hilangkan item sidebar yg level aksesnya "HIDE" utk user ybs (2026-08-03,
 * instruksi eksplisit user) -- grup yg SEMUA child-nya ikut hilang otomatis
 * ikut disembunyikan juga (drpd nampilin grup expandable kosong). Leaf yg
 * path-nya tidak terdaftar di MENU_KEY_BY_PATH (Dashboard, Developer Tools,
 * dst -- belum py konsep View/Input/Hide) selalu lolos apa adanya. */
export function filterHiddenMenus(nodes: MenuNode[], user: StoredSession | null): MenuNode[] {
  const result: MenuNode[] = [];
  for (const node of nodes) {
    if (node.type === "leaf") {
      const key = MENU_KEY_BY_PATH[node.path];
      if (key && getMenuLevel(user, key) === "HIDE") continue;
      result.push(node);
    } else {
      const children = filterHiddenMenus(node.children, user);
      if (children.length > 0) result.push({ ...node, children });
    }
  }
  return result;
}

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
