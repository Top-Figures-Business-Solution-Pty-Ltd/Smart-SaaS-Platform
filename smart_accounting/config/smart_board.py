# -*- coding: utf-8 -*-
"""Versioned Smart Board business configuration.

Keep cross-cutting workflow constants here so status/admin APIs and patches do
not drift when Smart Grants years or workflow statuses change.
"""

GRANTS_YEAR_BOARDS: tuple[str, ...] = (
	"FY 2024",
	"FY 2025",
	"FY 2026",
	"FY 2027",
)

GRANTS_STATUS_ORDER: tuple[str, ...] = (
	"Not started",
	"Hold",
	"Waiting for kickoff",
	"Waiting for tech meeting",
	"Waiting for tech evidence",
	"Waiting for evidence review",
	"Preparing R&D report",
	"Waiting for report review and signature",
	"Preparing application form",
	"Waiting for AP review",
	"Waiting for financial accounts",
	"Preparing R&D exp calculation",
	"Waiting for responses to fin queries",
	"Final pack prep",
	"Waiting for CTR",
	"Waiting for payment",
	"Completed",
	"Not to Proceed",
)

GLOBAL_PROJECT_STATUS_POOL: tuple[str, ...] = (
	"Not started",
	"Working on it",
	"Waiting for client",
	"R&D",
	"Waiting for kickoff",
	"Waiting for tech meeting",
	"Waiting for tech evidence",
	"Waiting for evidence review",
	"Preparing R&D report",
	"Waiting for report review and signature",
	"Preparing application form",
	"Waiting for AP review",
	"Waiting for financial accounts",
	"Preparing R&D exp calculation",
	"Waiting for responses to fin queries",
	"Final pack prep",
	"Ready for manager review",
	"Review points to be actioned",
	"Ready for partner review",
	"Ready to send to client",
	"Sent to client for signature",
	"Hold",
	"Waiting for CTR",
	"Waiting for payment",
	"Not to Proceed",
	"Completed",
)
