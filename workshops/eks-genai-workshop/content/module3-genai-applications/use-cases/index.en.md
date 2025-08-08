---
title: "Use Cases"
weight: 45
duration: "40 minutes"
difficulty: "intermediate"
---

# Practical GenAI Use Cases

Explore real-world applications of GenAI systems including Intelligent Document Processing (IDP) and Construction Defect Management, demonstrating end-to-end workflows.

## Overview

This lab showcases practical implementations of GenAI systems in specific industry use cases, demonstrating how to combine multiple agents, tools, and knowledge sources to solve complex business problems.

## Learning Objectives

By the end of this lab, you will be able to:
- Implement end-to-end IDP workflows with GenAI
- Build industry-specific solutions for construction management
- Design multi-agent systems for complex business processes
- Integrate external APIs and data sources
- Monitor and optimize use case performance

## Prerequisites

- Completed [Multi-Agent Systems](/module3-genai-applications/multi-agent/)
- Understanding of document processing workflows
- Familiarity with business process automation

## Use Case Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                Use Case Architecture                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Document    │  │ Business    │  │ Integration │        │
│  │ Processing  │  │ Logic       │  │ Layer       │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│         │                 │                 │              │
│  ┌─────────────────────────────────────────────────────────┤
│  │              Multi-Agent Orchestration                 │
│  └─────────────────────────────────────────────────────────┤
│         │                 │                 │              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ External    │  │ Knowledge   │  │ Workflow    │        │
│  │ Systems     │  │ Base        │  │ Engine      │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Lab: Implementing Use Cases

### Use Case 1: Intelligent Document Processing (IDP)

```python
# idp_use_case.py
import asyncio
import json
import base64
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from datetime import datetime
import aiohttp
import aiofiles

@dataclass
class DocumentMetadata:
    document_id: str
    filename: str
    document_type: str
    upload_timestamp: datetime
    file_size: int
    mime_type: str

@dataclass
class ExtractionResult:
    document_id: str
    extracted_text: str
    structured_data: Dict[str, Any]
    confidence_score: float
    processing_time: float
    extraction_method: str

class DocumentIngestionAgent:
    def __init__(self):
        self.supported_formats = ['.pdf', '.docx', '.txt', '.jpg', '.png']
    
    async def ingest_document(self, file_path: str) -> DocumentMetadata:
        """Ingest and validate document"""
        
        # Mock document ingestion
        import os
        
        filename = os.path.basename(file_path)
        file_size = 1024 * 1024  # Mock 1MB file
        
        # Determine document type
        doc_type = self.classify_document_type(filename)
        
        metadata = DocumentMetadata(
            document_id=f"doc_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            filename=filename,
            document_type=doc_type,
            upload_timestamp=datetime.now(),
            file_size=file_size,
            mime_type=self.get_mime_type(filename)
        )
        
        print(f"Ingested document: {metadata.filename} ({metadata.document_type})")
        return metadata
    
    def classify_document_type(self, filename: str) -> str:
        """Classify document type based on filename and content"""
        
        filename_lower = filename.lower()
        
        if 'invoice' in filename_lower:
            return 'invoice'
        elif 'contract' in filename_lower:
            return 'contract'
        elif 'report' in filename_lower:
            return 'report'
        elif 'form' in filename_lower:
            return 'form'
        else:
            return 'general_document'
    
    def get_mime_type(self, filename: str) -> str:
        """Get MIME type from filename"""
        
        extension = filename.lower().split('.')[-1]
        mime_types = {
            'pdf': 'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'txt': 'text/plain',
            'jpg': 'image/jpeg',
            'png': 'image/png'
        }
        
        return mime_types.get(extension, 'application/octet-stream')

class OCRAgent:
    def __init__(self):
        self.ocr_engines = ['tesseract', 'aws_textract', 'google_vision']
    
    async def extract_text(self, document_metadata: DocumentMetadata) -> str:
        """Extract text from document using OCR"""
        
        # Mock OCR processing
        await asyncio.sleep(1)  # Simulate processing time
        
        if document_metadata.document_type == 'invoice':
            return """
            INVOICE
            Invoice Number: INV-2024-001
            Date: 2024-01-15
            Bill To: Acme Corporation
            123 Business St, City, State 12345
            
            Description: Professional Services
            Amount: $5,000.00
            Tax: $500.00
            Total: $5,500.00
            
            Payment Terms: Net 30
            """
        elif document_metadata.document_type == 'contract':
            return """
            SERVICE AGREEMENT
            
            This agreement is between Company A and Company B
            Effective Date: January 1, 2024
            Term: 12 months
            
            Services: Software development and maintenance
            Payment: $10,000 monthly
            
            Termination: Either party may terminate with 30 days notice
            """
        else:
            return f"Extracted text content from {document_metadata.filename}"
    
    async def extract_structured_data(self, text: str, 
                                    document_type: str) -> Dict[str, Any]:
        """Extract structured data from text based on document type"""
        
        if document_type == 'invoice':
            return {
                'invoice_number': 'INV-2024-001',
                'date': '2024-01-15',
                'vendor': 'Service Provider Inc.',
                'customer': 'Acme Corporation',
                'total_amount': 5500.00,
                'tax_amount': 500.00,
                'payment_terms': 'Net 30',
                'line_items': [
                    {
                        'description': 'Professional Services',
                        'amount': 5000.00
                    }
                ]
            }
        elif document_type == 'contract':
            return {
                'contract_type': 'Service Agreement',
                'parties': ['Company A', 'Company B'],
                'effective_date': '2024-01-01',
                'term_months': 12,
                'monthly_payment': 10000.00,
                'termination_notice_days': 30
            }
        else:
            return {
                'document_type': document_type,
                'extracted_entities': ['entity1', 'entity2'],
                'key_phrases': ['phrase1', 'phrase2']
            }

class ValidationAgent:
    def __init__(self):
        self.validation_rules = {
            'invoice': self.validate_invoice,
            'contract': self.validate_contract,
            'general_document': self.validate_general
        }
    
    async def validate_extraction(self, extraction_result: ExtractionResult) -> Dict[str, Any]:
        """Validate extracted data"""
        
        document_type = extraction_result.structured_data.get('document_type', 'general_document')
        validator = self.validation_rules.get(document_type, self.validate_general)
        
        validation_result = await validator(extraction_result.structured_data)
        
        return {
            'is_valid': validation_result['is_valid'],
            'confidence_score': validation_result['confidence_score'],
            'validation_errors': validation_result['errors'],
            'suggestions': validation_result['suggestions']
        }
    
    async def validate_invoice(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate invoice data"""
        
        errors = []
        suggestions = []
        
        # Check required fields
        required_fields = ['invoice_number', 'date', 'total_amount']
        for field in required_fields:
            if field not in data or not data[field]:
                errors.append(f"Missing required field: {field}")
        
        # Validate amounts
        if 'total_amount' in data and data['total_amount'] <= 0:
            errors.append("Total amount must be positive")
        
        # Check date format
        if 'date' in data:
            try:
                datetime.strptime(data['date'], '%Y-%m-%d')
            except ValueError:
                errors.append("Invalid date format")
        
        confidence_score = max(0.0, 1.0 - (len(errors) * 0.2))
        
        if confidence_score < 0.8:
            suggestions.append("Consider manual review due to validation errors")
        
        return {
            'is_valid': len(errors) == 0,
            'confidence_score': confidence_score,
            'errors': errors,
            'suggestions': suggestions
        }
    
    async def validate_contract(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate contract data"""
        
        errors = []
        suggestions = []
        
        # Check required fields
        required_fields = ['contract_type', 'parties', 'effective_date']
        for field in required_fields:
            if field not in data or not data[field]:
                errors.append(f"Missing required field: {field}")
        
        # Validate parties
        if 'parties' in data and len(data['parties']) < 2:
            errors.append("Contract must have at least 2 parties")
        
        confidence_score = max(0.0, 1.0 - (len(errors) * 0.25))
        
        return {
            'is_valid': len(errors) == 0,
            'confidence_score': confidence_score,
            'errors': errors,
            'suggestions': suggestions
        }
    
    async def validate_general(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate general document data"""
        
        return {
            'is_valid': True,
            'confidence_score': 0.8,
            'errors': [],
            'suggestions': ['Consider adding document-specific validation rules']
        }

class WorkflowOrchestrator:
    def __init__(self):
        self.ingestion_agent = DocumentIngestionAgent()
        self.ocr_agent = OCRAgent()
        self.validation_agent = ValidationAgent()
    
    async def process_document(self, file_path: str) -> Dict[str, Any]:
        """Process document through complete IDP workflow"""
        
        start_time = datetime.now()
        
        try:
            # Step 1: Document Ingestion
            print("Step 1: Document Ingestion")
            metadata = await self.ingestion_agent.ingest_document(file_path)
            
            # Step 2: Text Extraction
            print("Step 2: Text Extraction")
            extracted_text = await self.ocr_agent.extract_text(metadata)
            
            # Step 3: Structured Data Extraction
            print("Step 3: Structured Data Extraction")
            structured_data = await self.ocr_agent.extract_structured_data(
                extracted_text, metadata.document_type
            )
            
            # Step 4: Create Extraction Result
            processing_time = (datetime.now() - start_time).total_seconds()
            
            extraction_result = ExtractionResult(
                document_id=metadata.document_id,
                extracted_text=extracted_text,
                structured_data=structured_data,
                confidence_score=0.9,
                processing_time=processing_time,
                extraction_method='ocr_plus_nlp'
            )
            
            # Step 5: Validation
            print("Step 4: Validation")
            validation_result = await self.validation_agent.validate_extraction(extraction_result)
            
            # Step 6: Generate Final Result
            return {
                'document_metadata': metadata,
                'extraction_result': extraction_result,
                'validation_result': validation_result,
                'processing_status': 'completed',
                'total_processing_time': processing_time,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            return {
                'processing_status': 'failed',
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }

### Use Case 2: Construction Defect Management

class DefectDetectionAgent:
    def __init__(self):
        self.defect_categories = [
            'structural', 'electrical', 'plumbing', 'hvac', 
            'finishing', 'safety', 'code_violation'
        ]
    
    async def analyze_inspection_report(self, report_text: str) -> Dict[str, Any]:
        """Analyze inspection report for defects"""
        
        # Mock defect detection
        await asyncio.sleep(1)
        
        detected_defects = [
            {
                'defect_id': 'DEF-001',
                'category': 'structural',
                'severity': 'high',
                'description': 'Crack in foundation wall',
                'location': 'Basement, North Wall',
                'confidence': 0.92
            },
            {
                'defect_id': 'DEF-002',
                'category': 'electrical',
                'severity': 'medium',
                'description': 'Outlet not properly grounded',
                'location': 'Kitchen, East Wall',
                'confidence': 0.85
            }
        ]
        
        return {
            'total_defects': len(detected_defects),
            'defects': detected_defects,
            'risk_assessment': 'medium',
            'recommended_actions': [
                'Schedule structural engineer inspection',
                'Electrical work required before occupancy'
            ]
        }

class ComplianceAgent:
    def __init__(self):
        self.building_codes = {
            'structural': ['IBC-2021', 'ACI-318'],
            'electrical': ['NEC-2020', 'IEEE-C2'],
            'plumbing': ['IPC-2021', 'UPC-2021']
        }
    
    async def check_compliance(self, defects: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Check defects against building codes"""
        
        compliance_issues = []
        
        for defect in defects:
            category = defect['category']
            applicable_codes = self.building_codes.get(category, [])
            
            compliance_issues.append({
                'defect_id': defect['defect_id'],
                'applicable_codes': applicable_codes,
                'compliance_status': 'non_compliant' if defect['severity'] == 'high' else 'review_required',
                'required_actions': [
                    f"Review against {code}" for code in applicable_codes
                ]
            })
        
        return {
            'total_issues': len(compliance_issues),
            'compliance_issues': compliance_issues,
            'overall_compliance': 'non_compliant'
        }

class ConstructionDefectWorkflow:
    def __init__(self):
        self.defect_agent = DefectDetectionAgent()
        self.compliance_agent = ComplianceAgent()
    
    async def process_inspection(self, inspection_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process construction inspection through defect management workflow"""
        
        print("Processing construction inspection...")
        
        # Step 1: Defect Detection
        defect_analysis = await self.defect_agent.analyze_inspection_report(
            inspection_data.get('report_text', '')
        )
        
        # Step 2: Compliance Check
        compliance_result = await self.compliance_agent.check_compliance(
            defect_analysis['defects']
        )
        
        # Step 3: Generate Action Plan
        action_plan = self.generate_action_plan(defect_analysis, compliance_result)
        
        return {
            'inspection_id': inspection_data.get('inspection_id', 'INS-001'),
            'defect_analysis': defect_analysis,
            'compliance_result': compliance_result,
            'action_plan': action_plan,
            'processing_timestamp': datetime.now().isoformat()
        }
    
    def generate_action_plan(self, defect_analysis: Dict[str, Any], 
                           compliance_result: Dict[str, Any]) -> Dict[str, Any]:
        """Generate action plan based on defects and compliance issues"""
        
        high_priority_actions = []
        medium_priority_actions = []
        
        for defect in defect_analysis['defects']:
            if defect['severity'] == 'high':
                high_priority_actions.append({
                    'action': f"Address {defect['description']}",
                    'location': defect['location'],
                    'deadline': '7 days',
                    'responsible_party': 'General Contractor'
                })
            else:
                medium_priority_actions.append({
                    'action': f"Repair {defect['description']}",
                    'location': defect['location'],
                    'deadline': '30 days',
                    'responsible_party': 'Subcontractor'
                })
        
        return {
            'high_priority': high_priority_actions,
            'medium_priority': medium_priority_actions,
            'estimated_cost': 15000.00,
            'estimated_timeline': '45 days'
        }

# Demo application
async def run_use_cases_demo():
    """Run use cases demonstration"""
    
    print("=== GenAI Use Cases Demo ===\n")
    
    # Use Case 1: IDP Demo
    print("Use Case 1: Intelligent Document Processing")
    print("=" * 50)
    
    idp_orchestrator = WorkflowOrchestrator()
    
    # Process sample documents
    sample_documents = [
        "/tmp/sample_invoice.pdf",
        "/tmp/service_contract.docx",
        "/tmp/inspection_report.pdf"
    ]
    
    for doc_path in sample_documents:
        print(f"\nProcessing: {doc_path}")
        result = await idp_orchestrator.process_document(doc_path)
        
        if result['processing_status'] == 'completed':
            print(f"✅ Successfully processed in {result['total_processing_time']:.2f}s")
            print(f"Document Type: {result['document_metadata'].document_type}")
            print(f"Validation Score: {result['validation_result']['confidence_score']:.2f}")
        else:
            print(f"❌ Processing failed: {result.get('error', 'Unknown error')}")
    
    print("\n" + "=" * 70 + "\n")
    
    # Use Case 2: Construction Defect Management Demo
    print("Use Case 2: Construction Defect Management")
    print("=" * 50)
    
    construction_workflow = ConstructionDefectWorkflow()
    
    # Process sample inspection
    sample_inspection = {
        'inspection_id': 'INS-2024-001',
        'property_address': '123 Construction Ave',
        'inspector': 'John Smith',
        'inspection_date': '2024-01-15',
        'report_text': """
        Inspection Report for 123 Construction Ave
        
        Structural Issues:
        - Visible crack in foundation wall, approximately 6 inches long
        - Appears to be settling related
        
        Electrical Issues:
        - Kitchen outlet on east wall lacks proper grounding
        - GFCI protection missing in bathroom
        
        Overall Assessment:
        - Property requires attention before occupancy
        - Recommend structural engineer evaluation
        """
    }
    
    construction_result = await construction_workflow.process_inspection(sample_inspection)
    
    print(f"Inspection ID: {construction_result['inspection_id']}")
    print(f"Defects Found: {construction_result['defect_analysis']['total_defects']}")
    print(f"Compliance Status: {construction_result['compliance_result']['overall_compliance']}")
    print(f"High Priority Actions: {len(construction_result['action_plan']['high_priority'])}")
    print(f"Estimated Cost: ${construction_result['action_plan']['estimated_cost']:,.2f}")
    print(f"Timeline: {construction_result['action_plan']['estimated_timeline']}")
    
    print("\n=== Use Cases Demo Completed ===")

if __name__ == "__main__":
    asyncio.run(run_use_cases_demo())
```

Continue with [Agentic RAG](/module3-genai-applications/agentic-rag/) to learn about advanced retrieval-augmented generation patterns.