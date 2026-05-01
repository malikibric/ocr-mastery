# Smart Document Processing System  
## Take-Home Engineering Task

---

## Overview

Build and deploy a system that processes real-world business documents (invoices and purchase orders), extracts structured data, validates it, and presents it through a simple interface.

This task evaluates your ability to:
- Work end-to-end
- Handle imperfect data
- Design flexible systems

---

## Input Data

- PDF documents (clean and semi-structured)
- Images (including messy / OCR-like)
- CSV files (structured)
- TXT files (semi-structured)

> **Note:** Some documents intentionally contain incorrect or incomplete data.

---

## Core Requirements

### 1. Document Ingestion
- Support at least 2 formats (PDF, Image, CSV, TXT)
- Allow file upload or processing of provided dataset

### 2. Data Extraction
Extract the following fields:
- Document type (invoice or purchase order)
- Supplier / company name
- Document number
- Issue date and due date
- Currency
- Line items
- Subtotal, tax, total

### 3. Validation Engine
- Detect incorrect totals
- Identify missing fields
- Validate dates
- Validate line item calculations
- Detect duplicate document numbers

### 4. Review Interface
- Display extracted data
- Highlight validation issues
- Allow manual corrections
- Confirm and save final version

### 5. Data Persistence
- Store processed documents
- Allow viewing previously processed data

### 6. Status Workflow
- Uploaded
- Needs Review
- Validated
- Rejected

### 7. Dashboard
- List documents
- Show statuses
- Display detected issues
- Optional: totals grouped by currency

### 8. Deployment
- Deploy the application
- Provide a public link

---

## Technical Freedom

You may use any programming language, framework, or database.

---

## AI Usage

AI tools are allowed, but you must:
- Understand your implementation
- Include your own validation logic

---

## Submission Requirements

- GitHub repository
- Live deployed application
- README with setup instructions
- Explanation of approach
- AI tools used
- Improvements you would make

---

## Bonus Points

- OCR support for images
- Handling messy inputs
- Clean UI/UX
- Unit tests
- Docker setup
- API documentation

---

## Time Expectation

This task is designed to be completed in approximately **3�5 days**.

---

## Important Note

Some documents are intentionally incorrect.

A strong solution not only extracts data, but also **detects and reports inconsistencies**.


## Submission

Please submit your completed task by sending:

- GitHub repository link  
- Live application link  

to: **careers@mastery.ba**
