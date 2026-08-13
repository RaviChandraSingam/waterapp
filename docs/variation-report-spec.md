# Variation Report Feature Specification

## Overview
Add a new cross-month report page under the MAIN sidebar that allows users to query across multiple monthly records and identify consumption variations for flats. The report is query-only and does not change billing records.

Non-guest users can save variation exceptions with a reason. Saved exceptions are stored in a new database table and visible to non-guest users. Water Committee and Admin users can soft delete saved exceptions. All edits and deletes track the acting user and timestamp.

## Goals
- Provide a query interface for multi-month comparison
- Highlight the top 20 flat variations
- Allow non-guest users to save a reason for an observed variation
- Persist saved exceptions with audit metadata
- Enable Water Committee/Admin to soft delete saved exceptions
- Allow non-guest users to view saved exceptions from the UI

## User Stories
1. As any authenticated user, I can open a new report page from the MAIN menu and select 2 or more months.
2. As any authenticated user, I can view a table of flat-level variations across selected months.
3. As a guest, I can only query and view the report; I cannot save exceptions.
4. As a non-guest user, I can save a variation exception with a textual reason.
5. As a non-guest user, I can view the records I have saved.
6. As a Water Committee/Admin user, I can soft delete a saved exception and it disappears from the list.
7. The UI shows who created, edited, or deleted a saved exception and when.

## Data Model
Add a new table `variation_exceptions` with columns:
- id UUID PRIMARY KEY DEFAULT gen_random_uuid()
- monthly_record_ids JSONB NOT NULL
- month_labels JSONB NOT NULL
- flat_id UUID NOT NULL REFERENCES flats(id)
- flat_number VARCHAR(10) NOT NULL
- block_name VARCHAR(10) NOT NULL
- variation_litres NUMERIC NOT NULL
- variation_pct NUMERIC
- reason TEXT NOT NULL
- created_by UUID REFERENCES users(id)
- updated_by UUID REFERENCES users(id)
- deleted_by UUID REFERENCES users(id)
- created_at TIMESTAMP DEFAULT NOW()
- updated_at TIMESTAMP DEFAULT NOW()
- deleted_at TIMESTAMP

## UI Requirements
- New MAIN menu item named “Variation Report”
- Multi-select month picker using existing monthly records
- Report table with month columns and variation columns
- Highlight the top 20 rows by absolute variation magnitude
- Non-guest save controls with reason entry
- Saved exceptions list with edit and delete controls
- Soft delete is hidden from UI for deleted records

## API Requirements
- GET /api/variations/report?months[]=...&months[]=...
- POST /api/variations
- GET /api/variations
- PUT /api/variations/:id
- DELETE /api/variations/:id

## Acceptance Criteria
- The menu item appears for authenticated users
- The report loads for 2+ selected months
- Guests cannot save exceptions
- Non-guest users can save and view exceptions
- Water Committee/Admin can soft delete saved exceptions
- Audit information is shown when a saved record is displayed
