/**
 * Static source material for the seed. Kept apart from seed.ts so the
 * generation logic stays readable next to the lists it draws from.
 */

export const DEMO_PASSWORD = "Apollo!2026";

export const SEED_USERS = [
  {
    id: "usr_admin",
    email: "admin@apollo-ap.com",
    name: "Imelda Bautista",
    role: "ADMIN",
    title: "Controller",
    avatarColor: "#1E2229",
  },
  {
    id: "usr_approver",
    email: "approver@apollo-ap.com",
    name: "Ramon Villanueva",
    role: "APPROVER",
    title: "Finance Manager",
    avatarColor: "#3A5A8C",
  },
  {
    id: "usr_approver2",
    email: "c.lagman@apollo-ap.com",
    name: "Corazon Lagman",
    role: "APPROVER",
    title: "Director of Finance",
    avatarColor: "#7A4B7E",
  },
  {
    id: "usr_clerk",
    email: "clerk@apollo-ap.com",
    name: "Josefina Dimaculangan",
    role: "CLERK",
    title: "AP Specialist",
    avatarColor: "#166A5B",
  },
  {
    id: "usr_clerk2",
    email: "r.salvador@apollo-ap.com",
    name: "Rogelio Salvador",
    role: "CLERK",
    title: "AP Coordinator",
    avatarColor: "#8C5A2B",
  },
  {
    id: "usr_auditor",
    email: "auditor@apollo-ap.com",
    name: "Teresita Manalo",
    role: "AUDITOR",
    title: "Internal Audit",
    avatarColor: "#5C6470",
  },
] as const;

interface VendorSeed {
  name: string;
  category: string;
  terms: "NET_15" | "NET_30" | "NET_45" | "NET_60" | "DUE_ON_RECEIPT";
  method: "PESONET" | "INSTAPAY" | "RTGS" | "CHECK";
  /** Rough per-invoice size, in whole pesos, before variance is applied. */
  typical: number;
  city: string;
  province: string;
  /** Four digits, the Philippine format. */
  postalCode: string;
  /** Landline area code — 02 for Metro Manila, three digits in the provinces. */
  areaCode: string;
  /** Invoice number prefix. Vendors number their own invoices. */
  prefix: string;
  /**
   * VAT registration belongs to the supplier, not to the invoice. A registered
   * supplier bills 12% on everything; the rest bill none at all.
   */
  vatRegistered: boolean;
  /**
   * Fixed rather than rolled. With twelve vendors a random draw can leave the
   * roster lopsided, and the end-to-end checks pick vendors by position in the
   * dropdown — they need the selectable set to be the same on every run.
   */
  status: "ACTIVE" | "INACTIVE" | "PENDING_REVIEW";
}

/**
 * Twelve suppliers, covering all ten categories in VENDOR_CATEGORIES.
 *
 * `typical` values are set so the ledger lands with a median near ₱600,000 and
 * roughly one invoice in ten above the ₱3,000,000 owner-authorisation line —
 * often enough that the escalation is a real part of the workflow rather than a
 * curiosity nobody sees.
 *
 * Davao Southern is the inactive one deliberately: it sorts fifth, so it never
 * occupies the second or third option in a vendor dropdown, which is where
 * check-workflow and check-realtime pick from.
 */
export const SEED_VENDORS: VendorSeed[] = [
  { name: "Katipunan Audit & Advisory", category: "Professional Services", terms: "NET_60", method: "RTGS", typical: 2_900_000, city: "Muntinlupa", province: "Metro Manila", postalCode: "1780", areaCode: "02", prefix: "KAA", vatRegistered: true, status: "ACTIVE" },
  { name: "Bayanihan Cloud Systems", category: "Software & SaaS", terms: "NET_30", method: "PESONET", typical: 2_350_000, city: "Taguig", province: "Metro Manila", postalCode: "1630", areaCode: "02", prefix: "BCS", vatRegistered: true, status: "ACTIVE" },
  { name: "Escolta Legal Advisers", category: "Professional Services", terms: "NET_45", method: "RTGS", typical: 1_900_000, city: "Makati", province: "Metro Manila", postalCode: "1226", areaCode: "02", prefix: "ELA", vatRegistered: true, status: "ACTIVE" },
  { name: "Kalayaan Insurance Brokers", category: "Insurance", terms: "NET_30", method: "RTGS", typical: 1_600_000, city: "Makati", province: "Metro Manila", postalCode: "1227", areaCode: "02", prefix: "KIB", vatRegistered: true, status: "ACTIVE" },
  { name: "Luzon Grid Power Services", category: "Utilities", terms: "DUE_ON_RECEIPT", method: "PESONET", typical: 1_050_000, city: "San Fernando", province: "Pampanga", postalCode: "2000", areaCode: "045", prefix: "LGP", vatRegistered: true, status: "ACTIVE" },
  { name: "Sampaguita Creative Group", category: "Marketing", terms: "NET_30", method: "INSTAPAY", typical: 720_000, city: "Quezon City", province: "Metro Manila", postalCode: "1100", areaCode: "02", prefix: "SCG", vatRegistered: true, status: "ACTIVE" },
  { name: "Cebu Highland Hardware Supply", category: "Hardware & Equipment", terms: "NET_30", method: "CHECK", typical: 580_000, city: "Mandaue", province: "Cebu", postalCode: "6014", areaCode: "032", prefix: "CHH", vatRegistered: true, status: "ACTIVE" },
  { name: "Pasig River Facilities Management", category: "Facilities", terms: "NET_30", method: "CHECK", typical: 450_000, city: "Pasig", province: "Metro Manila", postalCode: "1600", areaCode: "02", prefix: "PRF", vatRegistered: true, status: "ACTIVE" },
  { name: "Batangas Coastal Freight", category: "Logistics", terms: "NET_15", method: "PESONET", typical: 310_000, city: "Batangas City", province: "Batangas", postalCode: "4200", areaCode: "043", prefix: "BCF", vatRegistered: true, status: "ACTIVE" },
  { name: "Mactan Corporate Travel", category: "Travel", terms: "NET_15", method: "INSTAPAY", typical: 195_000, city: "Lapu-Lapu", province: "Cebu", postalCode: "6015", areaCode: "032", prefix: "MCT", vatRegistered: false, status: "ACTIVE" },
  { name: "Amihan General Trading", category: "General", terms: "NET_30", method: "CHECK", typical: 135_000, city: "Laoag", province: "Ilocos Norte", postalCode: "2900", areaCode: "077", prefix: "AGT", vatRegistered: false, status: "PENDING_REVIEW" },
  { name: "Davao Southern Facilities Services", category: "Facilities", terms: "NET_45", method: "INSTAPAY", typical: 88_000, city: "Davao City", province: "Davao del Sur", postalCode: "8000", areaCode: "082", prefix: "DSF", vatRegistered: false, status: "INACTIVE" },
];

/** Line-item wording, keyed by vendor category so invoices read plausibly. */
export const LINE_ITEMS_BY_CATEGORY: Record<string, string[]> = {
  "Software & SaaS": [
    "Platform subscription — monthly",
    "Additional user seats",
    "API request overage",
    "Premium support tier",
    "Data egress charges",
    "Local data residency add-on",
    "SSO add-on module",
  ],
  "Professional Services": [
    "Senior consultant hours",
    "Associate consultant hours",
    "Engagement management fee",
    "Statutory audit — interim fieldwork",
    "Corporate secretarial retainer",
    "Regulatory filing fee",
    "Document review",
  ],
  Facilities: [
    "Monthly janitorial service",
    "Association dues",
    "Common area maintenance (CUSA)",
    "Aircon preventative maintenance",
    "Electrical repair — call out",
    "Waste collection",
    "Security services — manned posts",
  ],
  Logistics: [
    "Trucking — Metro Manila to provincial",
    "Port handling and arrastre",
    "Inter-island shipping — RORO",
    "Fuel surcharge",
    "Warehousing — pallet positions",
    "Customs brokerage",
    "Last-mile courier",
  ],
  Marketing: [
    "Media placement — digital",
    "Out-of-home media placement",
    "Creative production",
    "Campaign management fee",
    "Print production run",
    "Event booth fabrication",
  ],
  "Hardware & Equipment": [
    "Workstation units",
    "Network switching hardware",
    "Equipment rental — monthly",
    "Replacement components",
    "Extended warranty",
    "Installation labour",
  ],
  Travel: [
    "Domestic airfare — booked itinerary",
    "Hotel accommodation",
    "Airport transfers",
    "Booking service fee",
    "Travel insurance",
  ],
  Utilities: [
    "Electricity — metered consumption",
    "Water and sewerage",
    "Fibre leased line",
    "Postpaid mobile fleet plan",
    "Generator fuel and maintenance",
  ],
  Insurance: [
    "Fire and allied perils premium",
    "General liability premium",
    "Professional indemnity premium",
    "Documentary stamp tax on policy",
    "Policy administration fee",
  ],
  General: ["Goods supplied", "Services rendered", "Sundry charges"],
};

// Re-exported from the application's own pick lists, so seeded invoices carry
// codes the form can actually produce.
export { COST_CENTERS, GL_ACCOUNTS } from "../lib/form-options";

export const REJECTION_REASONS = [
  "Purchase order number does not match our records.",
  "Amount exceeds the quoted statement of work.",
  "Duplicate of an invoice already paid this quarter.",
  "Cost centre is wrong — this belongs to Engineering.",
  "Missing supporting documentation for the expense lines.",
  "Rates billed do not match the agreed contract schedule.",
];

export const APPROVAL_COMMENTS = [
  "Matches the PO and the delivery note.",
  "Checked against contract rates.",
  "Confirmed with the requesting team.",
  "Within budget for the quarter.",
  "Verified receipt of goods.",
  "",
  "",
  "",
];
