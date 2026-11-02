-- ============================================================================
-- CENTRALIZED HOSPITAL BED & EMERGENCY RESOURCE MANAGEMENT SYSTEM (CHR-MS)
-- Database Engine: PostgreSQL 16+ / 17+ / 18+
-- Target Database: hospital_db
-- Complete Idempotent Schema Snapshot & Seed Initialization
-- ============================================================================

-- Reset and isolate schema
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- Enable Generalized Search Tree (GiST) scalar index extensions for btree types
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- pgcrypto: bcrypt PIN hashing (crypt / gen_salt) and SHA-256 audit sealing (digest)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pg_trgm: fast fuzzy search over the 30,000-row national hospital directory
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 1. RELATIONAL SCHEMA DDL (CORE 8 TABLES IN FK HIERARCHY ORDER)
-- ============================================================================

-- Table 1: Departments
CREATE TABLE departments (
    dept_id SERIAL PRIMARY KEY,
    dept_code VARCHAR(10) NOT NULL UNIQUE,
    dept_name VARCHAR(100) NOT NULL UNIQUE,
    floor_number INT NOT NULL,
    emergency_contact VARCHAR(20) NOT NULL,
    annual_budget NUMERIC(14,2) NOT NULL DEFAULT 500000.00,
    CONSTRAINT chk_dept_code CHECK (dept_code ~ '^[A-Z]{3,4}[0-9]{1,2}$'),
    CONSTRAINT chk_floor CHECK (floor_number >= -2 AND floor_number <= 15),
    CONSTRAINT chk_budget CHECK (annual_budget >= 10000.00)
);

-- Table 2: Doctors
CREATE TABLE doctors (
    doctor_id SERIAL PRIMARY KEY,
    license_no VARCHAR(30) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    specialization VARCHAR(80) NOT NULL,
    dept_id INT NOT NULL REFERENCES departments(dept_id) ON DELETE RESTRICT,
    email VARCHAR(120) NOT NULL UNIQUE,
    phone VARCHAR(15) NOT NULL,
    consultation_fee NUMERIC(10,2) NOT NULL DEFAULT 500.00,
    is_on_duty BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT chk_doc_license CHECK (license_no ~ '^DOC-[0-9]{4}-[A-Z]{2}$'),
    CONSTRAINT chk_doc_email CHECK (email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT chk_doc_phone CHECK (phone ~ '^[0-9]{10}$'),
    CONSTRAINT chk_consult_fee CHECK (consultation_fee >= 200.00 AND consultation_fee <= 5000.00)
);

-- Table 3: Wards & Beds
CREATE TABLE wards_beds (
    bed_id SERIAL PRIMARY KEY,
    dept_id INT NOT NULL REFERENCES departments(dept_id) ON DELETE RESTRICT,
    room_number VARCHAR(20) NOT NULL,
    bed_label VARCHAR(10) NOT NULL,
    ward_type VARCHAR(30) NOT NULL,
    has_ventilator BOOLEAN NOT NULL DEFAULT false,
    has_oxygen_port BOOLEAN NOT NULL DEFAULT true,
    daily_tariff NUMERIC(10,2) NOT NULL,
    operational_status VARCHAR(25) NOT NULL DEFAULT 'Available',
    CONSTRAINT uq_room_bed UNIQUE (room_number, bed_label),
    CONSTRAINT chk_ward_type CHECK (ward_type IN ('General', 'Pediatric', 'Semi-Private', 'ICU', 'CCU', 'Burn-Unit')),
    CONSTRAINT chk_bed_state CHECK (operational_status IN ('Available', 'Occupied', 'Sanitizing', 'Out-Of-Service')),
    CONSTRAINT chk_tariff CHECK (daily_tariff > 0.00),
    CONSTRAINT chk_critical_infra CHECK (
        ward_type NOT IN ('ICU', 'CCU') OR (has_ventilator = true AND has_oxygen_port = true)
    )
);

-- Table 4: Patients
CREATE TABLE patients (
    patient_id SERIAL PRIMARY KEY,
    national_health_id VARCHAR(30) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    gender CHAR(1) NOT NULL,
    dob DATE NOT NULL,
    blood_group VARCHAR(5) NOT NULL,
    primary_phone VARCHAR(15) NOT NULL,
    emergency_contact_name VARCHAR(100),
    emergency_contact_phone VARCHAR(15),
    CONSTRAINT chk_pat_gender CHECK (gender IN ('M', 'F', 'O')),
    CONSTRAINT chk_pat_dob CHECK (dob <= CURRENT_DATE),
    CONSTRAINT chk_blood_group CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    CONSTRAINT chk_pat_phone CHECK (primary_phone ~ '^[0-9]{10}$'),
    CONSTRAINT chk_minor_emergency_contact CHECK (
        dob <= (CURRENT_DATE - INTERVAL '18 years') OR (
            emergency_contact_name IS NOT NULL AND emergency_contact_phone ~ '^[0-9]{10}$'
        )
    )
);

-- Table 5: Admissions (with GiST Temporal Exclusion & Stored Generated tsrange)
CREATE TABLE admissions (
    admission_id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL REFERENCES patients(patient_id) ON DELETE RESTRICT,
    bed_id INT NOT NULL REFERENCES wards_beds(bed_id) ON DELETE RESTRICT,
    admitting_doctor_id INT NOT NULL REFERENCES doctors(doctor_id) ON DELETE RESTRICT,
    triage_priority INT NOT NULL DEFAULT 3,
    admission_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    discharge_time TIMESTAMP,
    stay_duration_range tsrange GENERATED ALWAYS AS (
        tsrange(admission_time, COALESCE(discharge_time, 'infinity'::timestamp), '[)')
    ) STORED,
    admission_status VARCHAR(25) NOT NULL DEFAULT 'Admitted',
    admission_diagnosis TEXT NOT NULL,
    CONSTRAINT chk_triage_esi CHECK (triage_priority >= 1 AND triage_priority <= 5),
    CONSTRAINT chk_adm_status CHECK (
        admission_status IN ('Triage', 'Admitted', 'Transferred', 'Discharged', 'AMA', 'Deceased')
    ),
    CONSTRAINT chk_timeline CHECK (discharge_time IS NULL OR discharge_time > admission_time),
    CONSTRAINT ex_no_double_bed_booking EXCLUDE USING gist (
        bed_id WITH =,
        stay_duration_range WITH &&
    )
);

-- Table 6: Medical Equipments
CREATE TABLE medical_equipments (
    equipment_id SERIAL PRIMARY KEY,
    serial_number VARCHAR(50) NOT NULL UNIQUE,
    equipment_type VARCHAR(50) NOT NULL,
    assigned_bed_id INT REFERENCES wards_beds(bed_id) ON DELETE SET NULL,
    last_sterilized_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    maintenance_status VARCHAR(30) NOT NULL DEFAULT 'Operational',
    CONSTRAINT chk_eq_type CHECK (
        equipment_type IN ('Ventilator', 'Infusion Pump', 'Defibrillator', 'Dialysis Unit', 'Multiparameter Monitor')
    ),
    CONSTRAINT chk_maint_status CHECK (
        maintenance_status IN ('Operational', 'Maintenance-Due', 'Faulty', 'Sterilization-Pending')
    )
);

-- Table 7: Billing (with Stored Generated Columns & Cross-Column Rules)
CREATE TABLE billing (
    bill_id SERIAL PRIMARY KEY,
    admission_id INT NOT NULL UNIQUE REFERENCES admissions(admission_id) ON DELETE RESTRICT,
    bed_charges NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    clinical_procedure_charges NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    pharmacy_charges NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    gross_amount NUMERIC(12,2) GENERATED ALWAYS AS (
        (bed_charges + clinical_procedure_charges) + pharmacy_charges
    ) STORED,
    insurance_claim_approved NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    discount_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    net_patient_payable NUMERIC(12,2) GENERATED ALWAYS AS (
        (((bed_charges + clinical_procedure_charges) + pharmacy_charges) - insurance_claim_approved) - 
        (((bed_charges + clinical_procedure_charges) + pharmacy_charges) * (discount_percentage / 100.00))
    ) STORED,
    payment_status VARCHAR(25) NOT NULL DEFAULT 'Unpaid',
    settled_at TIMESTAMP,
    CONSTRAINT chk_bill_status CHECK (
        payment_status IN ('Unpaid', 'Partially-Paid', 'Settled', 'Insurance-Pending')
    ),
    CONSTRAINT chk_discount CHECK (discount_percentage >= 0.00 AND discount_percentage <= 50.00),
    CONSTRAINT chk_insurance_limit CHECK (
        insurance_claim_approved >= 0.00 AND insurance_claim_approved <= gross_amount
    ),
    CONSTRAINT chk_settled_time CHECK (
        (payment_status = 'Settled' AND settled_at IS NOT NULL) OR
        (payment_status <> 'Settled' AND settled_at IS NULL)
    )
);

-- Table 8: Bed Transfer Audit Trail
CREATE TABLE bed_transfer_audit (
    audit_id SERIAL PRIMARY KEY,
    admission_id INT NOT NULL REFERENCES admissions(admission_id) ON DELETE CASCADE,
    previous_bed_id INT NOT NULL,
    new_bed_id INT NOT NULL,
    transfer_reason VARCHAR(255) NOT NULL,
    transferred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    transferred_by_user VARCHAR(50) NOT NULL DEFAULT CURRENT_USER
);

-- ============================================================================
-- 2. SEED DATA INITIALIZATION (ORDERED BY DEPENDENCY)
-- ============================================================================

-- 2.1 Departments
INSERT INTO departments (dept_id, dept_code, dept_name, floor_number, emergency_contact, annual_budget) VALUES
(1, 'EMER01', 'Emergency & Trauma Core', 0, '9900112233', 1200000.00),
(2, 'CARD01', 'Cardiology & Catheterization', 2, '9900112244', 950000.00),
(3, 'NEUR01', 'Neurology & Stroke Center', 3, '9900112255', 850000.00),
(4, 'PEDI01', 'Pediatrics & Neonatal Care', 1, '9900112266', 600000.00);

-- 2.2 Doctors
INSERT INTO doctors (doctor_id, license_no, full_name, specialization, dept_id, email, phone, consultation_fee, is_on_duty) VALUES
(1, 'DOC-1001-TN', 'Dr. Arvind Swaminathan', 'Trauma Surgeon', 1, 'arvind.s@hospital.org', '9840112233', 1000.00, true),
(2, 'DOC-1002-TN', 'Dr. Radhika Menon', 'Interventional Cardiologist', 2, 'radhika.m@hospital.org', '9840223344', 1500.00, true),
(3, 'DOC-1003-TN', 'Dr. Vikram Seth', 'Critical Care Neurologist', 3, 'vikram.s@hospital.org', '9840334455', 1200.00, true),
(4, 'DOC-1004-TN', 'Dr. Sunita Kapoor', 'Pediatric Specialist', 4, 'sunita.k@hospital.org', '9840445566', 800.00, true),
(5, 'DOC-1005-TN', 'Dr. Meera Nambiar', 'Pediatric Pulmonologist', 4, 'meera.n@hospital.org', '9840556677', 950.00, false),
(6, 'DOC-1006-TN', 'Dr. Rajesh Varma', 'Emergency Medicine Specialist', 1, 'rajesh.v@hospital.org', '9840667788', 1100.00, true);

-- 2.3 Wards & Beds
INSERT INTO wards_beds (bed_id, dept_id, room_number, bed_label, ward_type, has_ventilator, has_oxygen_port, daily_tariff, operational_status) VALUES
(1,  1, 'ER-TRAUMA', 'B-1', 'General',      true,  true, 2500.00, 'Occupied'),
(2,  2, 'ICU-CARD',  'B-1', 'ICU',          true,  true, 8500.00, 'Available'),
(3,  2, 'ICU-CARD',  'B-2', 'ICU',          true,  true, 8500.00, 'Occupied'),
(4,  4, 'PED-WARD',  'B-1', 'Pediatric',    false, true, 1500.00, 'Available'),
(5,  3, 'NEU-WARD',  'B-1', 'Semi-Private', false, true, 3500.00, 'Available'),
(6,  1, 'ER-TRAUMA', 'B-2', 'General',      false, true, 2500.00, 'Available'),
(7,  1, 'ER-RESUS',  'B-1', 'ICU',          true,  true, 7500.00, 'Available'),
(8,  2, 'ICU-CARD',  'B-3', 'ICU',          true,  true, 8500.00, 'Sanitizing'),
(9,  2, 'CCU-STEP',  'B-1', 'Semi-Private', false, true, 4200.00, 'Available'),
(10, 3, 'NEU-ICU',   'B-1', 'ICU',          true,  true, 9000.00, 'Available'),
(11, 3, 'NEU-WARD',  'B-2', 'Semi-Private', false, true, 3500.00, 'Available'),
(12, 4, 'PED-WARD',  'B-2', 'Pediatric',    false, true, 1500.00, 'Sanitizing'),
(13, 4, 'NICU-CRIT', 'B-1', 'ICU',          true,  true, 6500.00, 'Available'),
(14, 1, 'ER-TRAUMA', 'B-3', 'General',      false, true, 2500.00, 'Available'),
(15, 1, 'ER-RESUS',  'B-2', 'ICU',          true,  true, 7500.00, 'Sanitizing'),
(16, 2, 'CCU-STEP',  'B-2', 'Semi-Private', false, true, 4200.00, 'Available'),
(17, 3, 'NEU-ICU',   'B-2', 'ICU',          true,  true, 9000.00, 'Available'),
(18, 3, 'NEU-WARD',  'B-3', 'Semi-Private', false, true, 3500.00, 'Out-Of-Service'),
(19, 4, 'PED-WARD',  'B-3', 'Pediatric',    false, true, 1500.00, 'Available'),
(20, 4, 'NICU-CRIT', 'B-2', 'ICU',          true,  true, 6500.00, 'Available');

-- 2.4 Patients
INSERT INTO patients (patient_id, national_health_id, full_name, gender, dob, blood_group, primary_phone, emergency_contact_name, emergency_contact_phone) VALUES
(1, 'NHID-IND-9901', 'Kavitha Ramachandran', 'F', '1988-06-15', 'O+',  '9876543210', 'R. Ramachandran', '9876543219'),
(2, 'NHID-IND-9902', 'Master Ayaan Khan',    'M', '2020-10-11', 'B+',  '9123456780', 'Farooq Khan',     '9123456789'),
(3, 'NHID-IND-9903', 'Ramesh Parthasarathy', 'M', '1965-02-10', 'A+',  '9444123456', 'Lakshmi P',       '9444123457'),
(4, 'NHID-IND-9904', 'Ananya Sharma',        'F', '1995-04-20', 'B-',  '9888112233', 'Rahul Sharma',    '9888112234'),
(5, 'NHID-IND-9905', 'Karthik Raja',         'M', '1982-11-12', 'O-',  '9777223344', 'Priya Raja',      '9777223345'),
(6, 'NHID-IND-9906', 'Baby Diya',            'F', '2023-01-15', 'AB+', '9666334455', 'Senthil Nathan',  '9666334456');

-- 2.5 Admissions
INSERT INTO admissions (admission_id, patient_id, bed_id, admitting_doctor_id, triage_priority, admission_time, discharge_time, admission_status, admission_diagnosis) VALUES
(1, 1, 2, 2, 1, '2026-10-07 01:13:15', '2026-10-10 01:13:15', 'Discharged', 'Acute Myocardial Infarction'),
(2, 2, 4, 4, 3, '2026-10-09 01:13:15', '2026-10-11 15:20:42', 'Discharged', 'Severe Bronchiolitis with Wheeze'),
(3, 3, 3, 2, 2, '2026-10-10 13:13:15', NULL,                  'Admitted',   'Unstable Angina & Arrhythmia'),
(4, 4, 1, 1, 1, '2026-10-11 15:20:32', NULL,                  'Admitted',   'Severe Polytrauma with Hemorrhagic Shock');

-- 2.6 Medical Equipments
INSERT INTO medical_equipments (equipment_id, serial_number, equipment_type, assigned_bed_id, last_sterilized_at, maintenance_status) VALUES
(1, 'EQ-VENT-001', 'Ventilator',             1,  '2026-10-10 08:00:00', 'Operational'),
(2, 'EQ-VENT-002', 'Ventilator',             2,  '2026-10-10 08:00:00', 'Operational'),
(3, 'EQ-VENT-003', 'Ventilator',             3,  '2026-10-10 08:00:00', 'Operational'),
(4, 'EQ-MON-001',  'Multiparameter Monitor', 7,  '2026-10-09 14:00:00', 'Operational'),
(5, 'EQ-DEFIB-001','Defibrillator',          1,  '2026-10-08 12:00:00', 'Operational'),
(6, 'EQ-INF-001',  'Infusion Pump',          10, '2026-10-11 09:30:00', 'Operational');

-- 2.7 Billing
INSERT INTO billing (bill_id, admission_id, bed_charges, clinical_procedure_charges, pharmacy_charges, insurance_claim_approved, discount_percentage, payment_status, settled_at) VALUES
(1, 1, 25500.00, 45000.00, 12800.00, 60000.00, 5.00,  'Settled', '2026-10-10 01:13:16'),
(2, 2, 4500.00,  3500.00,  1200.00,  2000.00,  10.00, 'Settled', '2026-10-11 15:20:42');

-- 2.8 Bed Transfer Audit
INSERT INTO bed_transfer_audit (audit_id, admission_id, previous_bed_id, new_bed_id, transfer_reason, transferred_at, transferred_by_user) VALUES
(1, 1, 7, 2, 'Post-Resuscitation Transfer to Cardiac ICU', '2026-10-07 03:00:00', 'clinical_supervisor');

-- Synchronize Identity Primary Key Sequences
SELECT setval('departments_dept_id_seq', (SELECT COALESCE(MAX(dept_id), 1) FROM departments));
SELECT setval('doctors_doctor_id_seq', (SELECT COALESCE(MAX(doctor_id), 1) FROM doctors));
SELECT setval('wards_beds_bed_id_seq', (SELECT COALESCE(MAX(bed_id), 1) FROM wards_beds));
SELECT setval('patients_patient_id_seq', (SELECT COALESCE(MAX(patient_id), 1) FROM patients));
SELECT setval('admissions_admission_id_seq', (SELECT COALESCE(MAX(admission_id), 1) FROM admissions));
SELECT setval('medical_equipments_equipment_id_seq', (SELECT COALESCE(MAX(equipment_id), 1) FROM medical_equipments));
SELECT setval('billing_bill_id_seq', (SELECT COALESCE(MAX(bill_id), 1) FROM billing));
SELECT setval('bed_transfer_audit_audit_id_seq', (SELECT COALESCE(MAX(audit_id), 1) FROM bed_transfer_audit));

-- ============================================================================
-- 3. RELATIONAL OPERATIONAL VIEWS
-- ============================================================================

-- View 1: Real-Time Live Bed Availability Grid
CREATE OR REPLACE VIEW V_Live_Bed_Availability AS
SELECT 
    wb.bed_id,
    wb.room_number,
    wb.bed_label,
    wb.ward_type,
    wb.operational_status,
    wb.has_ventilator,
    wb.has_oxygen_port,
    wb.daily_tariff,
    d.dept_id,
    d.dept_code,
    d.dept_name,
    d.floor_number,
    a.admission_id,
    p.national_health_id,
    p.full_name AS current_patient_name,
    p.gender AS patient_gender,
    a.triage_priority,
    a.admission_time,
    doc.full_name AS attending_physician
FROM wards_beds wb
INNER JOIN departments d ON wb.dept_id = d.dept_id
LEFT JOIN admissions a 
    ON wb.bed_id = a.bed_id 
    AND a.discharge_time IS NULL 
    AND a.admission_status = 'Admitted'
LEFT JOIN patients p ON a.patient_id = p.patient_id
LEFT JOIN doctors doc ON a.admitting_doctor_id = doc.doctor_id;

-- View 2: Pending Discharge and Clearance Ledger
CREATE OR REPLACE VIEW V_Pending_Discharge_Summary AS
SELECT 
    a.admission_id,
    p.national_health_id,
    p.full_name AS patient_name,
    wb.room_number || ' - ' || wb.bed_label AS bed_designation,
    a.admission_time,
    a.discharge_time,
    EXTRACT(DAY FROM (COALESCE(a.discharge_time, CURRENT_TIMESTAMP) - a.admission_time))::INT AS total_days_stayed,
    b.gross_amount,
    b.insurance_claim_approved,
    b.net_patient_payable,
    b.payment_status
FROM admissions a
INNER JOIN patients p ON a.patient_id = p.patient_id
INNER JOIN wards_beds wb ON a.bed_id = wb.bed_id
INNER JOIN billing b ON a.admission_id = b.admission_id
WHERE 
    a.admission_status = 'Discharged'
    AND b.payment_status IN ('Unpaid', 'Partially-Paid', 'Insurance-Pending');

-- View 3: Department Capacity & Real-Time Performance Ledger
CREATE OR REPLACE VIEW V_Department_Occupancy_Summary AS
SELECT 
    d.dept_id,
    d.dept_code,
    d.dept_name,
    d.floor_number,
    COUNT(wb.bed_id) AS total_beds,
    COUNT(wb.bed_id) FILTER (WHERE wb.operational_status = 'Occupied') AS occupied_beds,
    COUNT(wb.bed_id) FILTER (WHERE wb.operational_status = 'Available') AS available_beds,
    COUNT(wb.bed_id) FILTER (WHERE wb.operational_status = 'Sanitizing') AS sanitizing_beds,
    COALESCE(
        ROUND(
            (COUNT(wb.bed_id) FILTER (WHERE wb.operational_status = 'Occupied')::NUMERIC / 
            NULLIF(COUNT(wb.bed_id), 0)) * 100.0, 
            1
        ), 
        0.0
    ) AS occupancy_rate_pct
FROM departments d
LEFT JOIN wards_beds wb ON d.dept_id = wb.dept_id
GROUP BY d.dept_id, d.dept_code, d.dept_name, d.floor_number;

-- ============================================================================
-- 4. PL/pgSQL FUNCTIONS, STORED PROCEDURES & TRIGGERS
-- ============================================================================

-- Function 1: Deterministic Real-Time Department Occupancy Calculation
CREATE OR REPLACE FUNCTION fn_get_department_occupancy_rate(p_dept_id INT)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_total_beds INT := 0;
    v_occupied_beds INT := 0;
    v_occupancy_pct NUMERIC(5,2) := 0.00;
BEGIN
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE operational_status = 'Occupied')
    INTO 
        v_total_beds,
        v_occupied_beds
    FROM wards_beds
    WHERE dept_id = p_dept_id;

    IF v_total_beds = 0 THEN
        RETURN 0.00;
    END IF;

    v_occupancy_pct := ROUND((v_occupied_beds::NUMERIC / v_total_beds::NUMERIC) * 100.0, 2);
    RETURN v_occupancy_pct;
END;
$$;

-- Stored Procedure 1: Explicit Cursor-Driven Patient Discharge & Invoice Generation
CREATE OR REPLACE PROCEDURE sp_process_patient_discharge(
    p_admission_id INT,
    p_procedure_charges NUMERIC,
    p_pharmacy_charges NUMERIC,
    p_insurance_claim NUMERIC,
    p_discount_pct NUMERIC,
    p_payment_mode VARCHAR,
    INOUT p_bill_id INT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    cur_adm CURSOR(c_aid INT) FOR
        SELECT 
            a.admission_id,
            a.patient_id,
            a.bed_id,
            a.admission_time,
            a.admission_status,
            wb.daily_tariff
        FROM admissions a
        INNER JOIN wards_beds wb ON a.bed_id = wb.bed_id
        WHERE a.admission_id = c_aid
        FOR UPDATE OF a;

    rec_adm RECORD;
    v_stay_days INT;
    v_calculated_bed_charges NUMERIC(12,2);
    v_gross NUMERIC(12,2);
BEGIN
    OPEN cur_adm(p_admission_id);
    FETCH cur_adm INTO rec_adm;

    IF NOT FOUND THEN
        CLOSE cur_adm;
        RAISE EXCEPTION 'Discharge Error: Admission ID % does not exist.', p_admission_id
            USING ERRCODE = 'P0002';
    END IF;

    IF rec_adm.admission_status = 'Discharged' THEN
        CLOSE cur_adm;
        RAISE EXCEPTION 'Discharge Error: Admission % is already discharged.', p_admission_id
            USING ERRCODE = '22000';
    END IF;

    -- Calculate billable days (minimum 1 day policy)
    v_stay_days := GREATEST(
        1, 
        CEIL(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - rec_adm.admission_time)) / 86400.0)::INT
    );
    v_calculated_bed_charges := v_stay_days * rec_adm.daily_tariff;

    -- Validate Insurance ceiling against Gross
    v_gross := v_calculated_bed_charges + p_procedure_charges + p_pharmacy_charges;
    IF p_insurance_claim > v_gross THEN
        CLOSE cur_adm;
        RAISE EXCEPTION 'Constraint Error: Insurance ($%) exceeds gross ($%).', p_insurance_claim, v_gross
            USING ERRCODE = '23514';
    END IF;

    -- Update Admission State
    UPDATE admissions
    SET 
        admission_status = 'Discharged',
        discharge_time = CURRENT_TIMESTAMP
    WHERE admission_id = rec_adm.admission_id;

    CLOSE cur_adm;

    -- Insert Finalized Invoice into Billing
    INSERT INTO billing (
        admission_id,
        bed_charges,
        clinical_procedure_charges,
        pharmacy_charges,
        insurance_claim_approved,
        discount_percentage,
        payment_status,
        settled_at
    ) VALUES (
        p_admission_id,
        v_calculated_bed_charges,
        p_procedure_charges,
        p_pharmacy_charges,
        p_insurance_claim,
        p_discount_pct,
        p_payment_mode,
        CASE WHEN p_payment_mode = 'Settled' THEN CURRENT_TIMESTAMP ELSE NULL END
    )
    RETURNING bill_id INTO p_bill_id;

    RAISE NOTICE 'Admission % successfully discharged. Bill #% generated.', p_admission_id, p_bill_id;
END;
$$;

-- Trigger Function: State-Synchronization & Transfer Audit
CREATE OR REPLACE FUNCTION trg_fn_sync_bed_status()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$
BEGIN
    -- Scenario A: New Admission
    IF TG_OP = 'INSERT' THEN
        IF NEW.admission_status = 'Admitted' THEN
            UPDATE wards_beds 
            SET operational_status = 'Occupied' 
            WHERE bed_id = NEW.bed_id;
        END IF;
        RETURN NEW;

    -- Scenario B: Bed Transfer or Discharge Update
    ELSIF TG_OP = 'UPDATE' THEN
        -- Inter-Bed Transfer
        IF OLD.bed_id <> NEW.bed_id THEN
            UPDATE wards_beds 
            SET operational_status = 'Sanitizing' 
            WHERE bed_id = OLD.bed_id;

            UPDATE wards_beds 
            SET operational_status = 'Occupied' 
            WHERE bed_id = NEW.bed_id;

            INSERT INTO bed_transfer_audit (
                admission_id,
                previous_bed_id,
                new_bed_id,
                transfer_reason,
                transferred_at,
                transferred_by_user
            ) VALUES (
                NEW.admission_id,
                OLD.bed_id,
                NEW.bed_id,
                'Inter-Ward Clinical Reassignment',
                CURRENT_TIMESTAMP,
                CURRENT_USER
            );
        END IF;

        -- Discharge Finalization
        IF OLD.discharge_time IS NULL AND NEW.discharge_time IS NOT NULL THEN
            UPDATE wards_beds 
            SET operational_status = 'Sanitizing' 
            WHERE bed_id = NEW.bed_id;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

-- Trigger Binding on Admissions
DROP TRIGGER IF EXISTS trg_admission_bed_sync ON admissions;
CREATE TRIGGER trg_admission_bed_sync
AFTER INSERT OR UPDATE ON admissions
FOR EACH ROW
EXECUTE FUNCTION trg_fn_sync_bed_status();

-- ============================================================================
-- 5. STAFF AUTHENTICATION (badge + Pulse-PIN login, sessions, break-glass)
-- ============================================================================

-- Table 9: Staff Accounts (PINs stored only as bcrypt hashes via pgcrypto)
CREATE TABLE staff_accounts (
    staff_id SERIAL PRIMARY KEY,
    staff_code VARCHAR(20) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    staff_role VARCHAR(20) NOT NULL,
    doctor_id INT UNIQUE REFERENCES doctors(doctor_id) ON DELETE SET NULL,
    pin_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_staff_role CHECK (staff_role IN ('Doctor', 'Nurse', 'Admin', 'Billing')),
    CONSTRAINT chk_staff_code CHECK (staff_code ~ '^(DOC-[0-9]{4}-[A-Z]{2}|(NUR|ADM|BIL)-[0-9]{4})$'),
    CONSTRAINT chk_doctor_link CHECK (doctor_id IS NULL OR staff_role = 'Doctor'),
    CONSTRAINT chk_pin_is_bcrypt CHECK (pin_hash LIKE '$2%')
);

-- Table 10: Staff Sessions (only a SHA-256 hash of the cookie token is stored)
CREATE TABLE staff_sessions (
    session_id SERIAL PRIMARY KEY,
    staff_id INT NOT NULL REFERENCES staff_accounts(staff_id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    access_mode VARCHAR(15) NOT NULL DEFAULT 'standard',
    break_glass_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    CONSTRAINT chk_access_mode CHECK (access_mode IN ('standard', 'break_glass')),
    CONSTRAINT chk_break_glass_reason CHECK (
        access_mode <> 'break_glass' OR length(trim(coalesce(break_glass_reason, ''))) >= 10
    ),
    CONSTRAINT chk_session_window CHECK (expires_at > created_at),
    CONSTRAINT chk_break_glass_window CHECK (
        access_mode <> 'break_glass' OR expires_at <= created_at + INTERVAL '15 minutes'
    )
);

-- Table 11: Login Audit Trail (every attempt, success, lock-out, break-glass, logout)
CREATE TABLE login_audit (
    audit_id SERIAL PRIMARY KEY,
    staff_code VARCHAR(20) NOT NULL,
    staff_id INT REFERENCES staff_accounts(staff_id) ON DELETE SET NULL,
    event_type VARCHAR(20) NOT NULL,
    detail TEXT,
    ip_address VARCHAR(64),
    user_agent TEXT,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_event_type CHECK (
        event_type IN ('login_success', 'login_failed', 'locked_out', 'break_glass', 'logout')
    )
);
CREATE INDEX idx_login_audit_code_time ON login_audit (staff_code, occurred_at DESC);

-- Seed staff badges (demo PIN for every badge: 246810)
INSERT INTO staff_accounts (staff_code, full_name, staff_role, doctor_id, pin_hash) VALUES
('DOC-1001-TN', 'Dr. Arvind Swaminathan', 'Doctor',  1,    crypt('246810', gen_salt('bf', 10))),
('DOC-1002-TN', 'Dr. Radhika Menon',      'Doctor',  2,    crypt('246810', gen_salt('bf', 10))),
('NUR-2001',    'Sr. Lakshmi Iyer',       'Nurse',   NULL, crypt('246810', gen_salt('bf', 10))),
('BIL-3001',    'Farhan Qureshi',         'Billing', NULL, crypt('246810', gen_salt('bf', 10))),
('ADM-0001',    'Meera Pillai',           'Admin',   NULL, crypt('246810', gen_salt('bf', 10)));

-- Function: authenticate a badge + PIN inside the database.
-- Verifies the bcrypt hash, enforces lock-out (5 failures in 15 minutes) and writes the audit row.
CREATE OR REPLACE FUNCTION fn_authenticate_staff(
    p_staff_code VARCHAR,
    p_pin TEXT,
    p_ip VARCHAR DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE (
    result VARCHAR,
    staff_id INT,
    full_name VARCHAR,
    staff_role VARCHAR,
    attempts_left INT,
    retry_after_seconds INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    c_max_failures CONSTANT INT := 5;
    c_window CONSTANT INTERVAL := INTERVAL '15 minutes';
    v_code VARCHAR := upper(trim(p_staff_code));
    v_last_success TIMESTAMP;
    v_failures INT;
    v_last_failure TIMESTAMP;
    v_staff staff_accounts%ROWTYPE;
BEGIN
    SELECT max(la.occurred_at) INTO v_last_success
    FROM login_audit la
    WHERE la.staff_code = v_code AND la.event_type IN ('login_success', 'break_glass');

    SELECT count(*), max(la.occurred_at) INTO v_failures, v_last_failure
    FROM login_audit la
    WHERE la.staff_code = v_code
      AND la.event_type = 'login_failed'
      AND la.occurred_at > CURRENT_TIMESTAMP - c_window
      AND la.occurred_at > coalesce(v_last_success, '-infinity'::timestamp);

    SELECT * INTO v_staff FROM staff_accounts sa WHERE sa.staff_code = v_code AND sa.is_active;

    IF v_failures >= c_max_failures THEN
        INSERT INTO login_audit (staff_code, staff_id, event_type, ip_address, user_agent)
        VALUES (v_code, v_staff.staff_id, 'locked_out', p_ip, p_user_agent);
        RETURN QUERY SELECT 'locked'::VARCHAR, NULL::INT, NULL::VARCHAR, NULL::VARCHAR, 0,
            GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_last_failure + c_window - CURRENT_TIMESTAMP))))::INT;
        RETURN;
    END IF;

    IF v_staff.staff_id IS NOT NULL AND v_staff.pin_hash = crypt(p_pin, v_staff.pin_hash) THEN
        INSERT INTO login_audit (staff_code, staff_id, event_type, ip_address, user_agent)
        VALUES (v_code, v_staff.staff_id, 'login_success', p_ip, p_user_agent);
        RETURN QUERY SELECT 'ok'::VARCHAR, v_staff.staff_id, v_staff.full_name, v_staff.staff_role, c_max_failures, 0;
        RETURN;
    END IF;

    -- Unknown badges and wrong PINs look identical to the caller (no account enumeration)
    INSERT INTO login_audit (staff_code, staff_id, event_type, ip_address, user_agent)
    VALUES (v_code, v_staff.staff_id, 'login_failed', p_ip, p_user_agent);

    IF v_failures + 1 >= c_max_failures THEN
        RETURN QUERY SELECT 'locked'::VARCHAR, NULL::INT, NULL::VARCHAR, NULL::VARCHAR, 0,
            EXTRACT(EPOCH FROM c_window)::INT;
    ELSE
        RETURN QUERY SELECT 'invalid'::VARCHAR, NULL::INT, NULL::VARCHAR, NULL::VARCHAR,
            c_max_failures - (v_failures + 1), 0;
    END IF;
END;
$$;

-- ============================================================================
-- 6. REAL-WORLD REFERENCE DATASETS & UPFRONT COST ESTIMATOR
--    Tables are created here; scripts/init-db.js loads the rows from
--    database/datasets/*.csv.gz and refreshes mv_condition_benchmarks.
-- ============================================================================

-- Table 12: Provenance of every public dataset loaded into hospital_db
CREATE TABLE dataset_sources (
    source_key VARCHAR(40) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    publisher VARCHAR(200) NOT NULL,
    source_url TEXT NOT NULL,
    mirror_url TEXT,
    licence VARCHAR(120),
    raw_sha256 CHAR(64),
    rows_in_source INT,
    rows_loaded INT NOT NULL DEFAULT 0,
    notes TEXT,
    loaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_source_sha CHECK (raw_sha256 IS NULL OR raw_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_source_rows CHECK (rows_loaded >= 0)
);

-- Table 13: National Hospital Directory (National Health Portal, Govt. of India): 30,273 real facilities
CREATE TABLE nhp_hospitals (
    nhp_id INT PRIMARY KEY,
    hospital_name VARCHAR(200) NOT NULL,
    hospital_category VARCHAR(40),
    care_type VARCHAR(60),
    discipline VARCHAR(80),
    address VARCHAR(300),
    state VARCHAR(60) NOT NULL,
    district VARCHAR(80),
    pincode CHAR(6),
    telephone VARCHAR(60),
    mobile VARCHAR(60),
    emergency_phone VARCHAR(60),
    ambulance_phone VARCHAR(60),
    bloodbank_phone VARCHAR(60),
    specialties VARCHAR(600),
    facilities VARCHAR(600),
    total_beds INT,
    emergency_services VARCHAR(60),
    latitude NUMERIC(9,6),
    longitude NUMERIC(9,6),
    geo_source VARCHAR(10),
    -- Can this facility plausibly receive an emergency diversion? Computed and stored by PostgreSQL.
    er_capable BOOLEAN GENERATED ALWAYS AS (
        hospital_name ~* '(hospital|medical college|institute|nursing home|trauma|health cent|medical cent|infirmary)'
        AND hospital_name !~* '(eye|ophthalm|nethra|dental|ayur|homo?eo|siddha|unani|physio|diagnos|scan|lab|skin|ivf|fertility|psychiat|rehab|veterin|clinic)'
        AND coalesce(discipline, 'Allopathic') ILIKE '%Allopathic%'
    ) STORED,
    CONSTRAINT chk_nhp_pincode CHECK (pincode IS NULL OR pincode ~ '^[0-9]{6}$'),
    CONSTRAINT chk_nhp_geo CHECK (
        (latitude IS NULL AND longitude IS NULL AND geo_source IS NULL) OR
        (latitude BETWEEN 6 AND 37.6 AND longitude BETWEEN 68 AND 97.5 AND geo_source IN ('directory', 'pincode'))
    ),
    CONSTRAINT chk_nhp_beds CHECK (total_beds IS NULL OR total_beds >= 0)
);
CREATE INDEX idx_nhp_state_district ON nhp_hospitals (state, district);
CREATE INDEX idx_nhp_er_geo ON nhp_hospitals (latitude, longitude) WHERE er_capable;
CREATE INDEX idx_nhp_name_trgm ON nhp_hospitals USING gin (hospital_name gin_trgm_ops);

-- Table 14: India pincode centroids (India Post), so a crew can report its position by pincode
CREATE TABLE india_pincodes (
    pincode CHAR(6) PRIMARY KEY,
    locality VARCHAR(80) NOT NULL,
    district VARCHAR(60) NOT NULL,
    state VARCHAR(60) NOT NULL,
    latitude NUMERIC(9,6) NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    post_offices INT NOT NULL DEFAULT 1,
    CONSTRAINT chk_pin_format CHECK (pincode ~ '^[0-9]{6}$'),
    CONSTRAINT chk_pin_geo CHECK (latitude BETWEEN 6 AND 37.6 AND longitude BETWEEN 68 AND 97.5)
);

-- Table 15: This hospital's own location (exactly one row)
CREATE TABLE hospital_profile (
    profile_id INT PRIMARY KEY DEFAULT 1,
    hospital_name VARCHAR(120) NOT NULL,
    city VARCHAR(60) NOT NULL,
    district VARCHAR(60) NOT NULL,
    state VARCHAR(60) NOT NULL,
    pincode CHAR(6) NOT NULL,
    latitude NUMERIC(9,6) NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    er_phone VARCHAR(15) NOT NULL,
    CONSTRAINT chk_single_profile CHECK (profile_id = 1)
);
INSERT INTO hospital_profile VALUES
(1, 'MediResource Hospital', 'Vellore', 'Vellore', 'Tamil Nadu', '632014', 12.961585, 79.151802, '9900112233');

-- Table 16: Condition catalogue (CCSR diagnosis groups, the coding used by the real discharge data)
CREATE TABLE condition_catalog (
    condition_id INT PRIMARY KEY,
    ccsr_code VARCHAR(10) NOT NULL,
    age_scope VARCHAR(5) NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    ccsr_description VARCHAR(160) NOT NULL,
    dept_id INT NOT NULL REFERENCES departments(dept_id) ON DELETE RESTRICT,
    default_ward_type VARCHAR(30) NOT NULL,
    source_population INT,
    CONSTRAINT uq_condition_scope UNIQUE (ccsr_code, age_scope),
    CONSTRAINT chk_ccsr_code CHECK (ccsr_code ~ '^[A-Z]{3}[0-9]{3}$'),
    CONSTRAINT chk_age_scope CHECK (age_scope IN ('adult', 'child')),
    CONSTRAINT chk_condition_ward CHECK (default_ward_type IN ('General', 'Pediatric', 'Semi-Private', 'ICU', 'CCU', 'Burn-Unit'))
);

INSERT INTO condition_catalog (condition_id, ccsr_code, age_scope, display_name, ccsr_description, dept_id, default_ward_type) VALUES
(1,  'INF002', 'adult', 'Sepsis (bloodstream infection)',        'Septicemia',                                                   1, 'ICU'),
(2,  'INJ008', 'adult', 'Head injury',                           'Traumatic brain injury (TBI); concussion, initial encounter',  1, 'ICU'),
(3,  'INJ010', 'adult', 'Internal organ injury (polytrauma)',    'Internal organ injury, initial encounter',                     1, 'ICU'),
(4,  'INJ006', 'adult', 'Hip fracture',                          'Fracture of the neck of the femur (hip), initial encounter',   1, 'General'),
(5,  'INJ005', 'adult', 'Leg fracture (not hip)',                'Fracture of the lower limb (except hip), initial encounter',   1, 'General'),
(6,  'INJ003', 'adult', 'Rib or pelvic fracture',                'Fracture of torso, initial encounter',                         1, 'General'),
(7,  'INJ022', 'adult', 'Drug poisoning or overdose',            'Poisoning by drugs, initial encounter',                        1, 'General'),
(8,  'INJ019', 'adult', 'Burns',                                 'Burn and corrosion, initial encounter',                        1, 'General'),
(9,  'RSP012', 'adult', 'Respiratory failure',                   'Respiratory failure; insufficiency; arrest',                   1, 'ICU'),
(10, 'RSP002', 'adult', 'Pneumonia',                             'Pneumonia (except that caused by tuberculosis)',               1, 'General'),
(11, 'DIG009', 'adult', 'Appendicitis',                          'Appendicitis and other appendiceal conditions',                1, 'General'),
(12, 'DIG021', 'adult', 'Stomach or bowel bleeding',             'Gastrointestinal hemorrhage',                                  1, 'General'),
(13, 'INF012', 'adult', 'COVID-19',                              'Coronavirus disease 2019 (COVID-19)',                          1, 'General'),
(14, 'CIR009', 'adult', 'Heart attack (acute MI)',               'Acute myocardial infarction',                                  2, 'ICU'),
(15, 'CIR019', 'adult', 'Heart failure',                         'Heart failure',                                                2, 'Semi-Private'),
(16, 'CIR017', 'adult', 'Irregular heartbeat (arrhythmia)',      'Cardiac dysrhythmias',                                         2, 'Semi-Private'),
(17, 'CIR011', 'adult', 'Coronary artery disease / angina',      'Coronary atherosclerosis and other heart disease',             2, 'Semi-Private'),
(18, 'CIR012', 'adult', 'Chest pain, cause not yet known',       'Nonspecific chest pain',                                       2, 'Semi-Private'),
(19, 'CIR013', 'adult', 'Clot in the lungs (pulmonary embolism)','Acute pulmonary embolism',                                     2, 'ICU'),
(20, 'CIR020', 'adult', 'Ischaemic stroke',                      'Cerebral infarction',                                          3, 'ICU'),
(21, 'CIR021', 'adult', 'Brain bleed (haemorrhagic stroke)',     'Acute hemorrhagic cerebrovascular disease',                    3, 'ICU'),
(22, 'NVS009', 'adult', 'Seizures / epilepsy',                   'Epilepsy; convulsions',                                        3, 'Semi-Private'),
(23, 'NVS012', 'adult', 'Mini-stroke (TIA)',                     'Transient cerebral ischemia',                                  3, 'Semi-Private'),
(24, 'INJ009', 'adult', 'Spinal cord injury',                    'Spinal cord injury (SCI), initial encounter',                  3, 'ICU'),
(25, 'RSP009', 'child', 'Asthma attack (child)',                 'Asthma',                                                       4, 'Pediatric'),
(26, 'RSP005', 'child', 'Bronchiolitis / chest infection (child)','Acute bronchitis',                                            4, 'Pediatric'),
(27, 'RSP002', 'child', 'Pneumonia (child)',                     'Pneumonia (except that caused by tuberculosis)',               4, 'Pediatric'),
(28, 'NVS009', 'child', 'Seizures (child)',                      'Epilepsy; convulsions',                                        4, 'Pediatric'),
(29, 'DIG001', 'child', 'Diarrhoea / gut infection (child)',     'Intestinal infection',                                         4, 'Pediatric'),
(30, 'PNL007', 'child', 'Newborn jaundice',                      'Hemolytic jaundice and perinatal jaundice',                    4, 'ICU'),
(31, 'PNL006', 'child', 'Newborn breathing problem',             'Respiratory perinatal condition',                              4, 'ICU'),
(32, 'INF002', 'child', 'Sepsis (child)',                        'Septicemia',                                                   4, 'ICU');

-- Table 17: Real de-identified hospital stays (New York SPARCS 2021, stratified sample)
CREATE TABLE historical_discharges (
    discharge_id SERIAL PRIMARY KEY,
    source_key VARCHAR(40) NOT NULL REFERENCES dataset_sources(source_key) ON DELETE CASCADE,
    condition_id INT NOT NULL REFERENCES condition_catalog(condition_id) ON DELETE CASCADE,
    ccsr_dx_code VARCHAR(10) NOT NULL,
    facility_name VARCHAR(120) NOT NULL,
    region VARCHAR(40),
    age_group VARCHAR(20) NOT NULL,
    gender CHAR(1) NOT NULL,
    admission_type VARCHAR(20) NOT NULL,
    ed_admission BOOLEAN NOT NULL,
    severity_code SMALLINT NOT NULL,
    mortality_risk VARCHAR(20),
    medical_surgical VARCHAR(20),
    length_of_stay SMALLINT NOT NULL,
    disposition_group VARCHAR(40),
    died_in_hospital BOOLEAN NOT NULL,
    payment_type VARCHAR(40),
    total_charges_usd NUMERIC(12,2) NOT NULL,
    total_costs_usd NUMERIC(12,2) NOT NULL,
    CONSTRAINT chk_hist_gender CHECK (gender IN ('M', 'F', 'U')),
    CONSTRAINT chk_hist_severity CHECK (severity_code BETWEEN 1 AND 4),
    CONSTRAINT chk_hist_los CHECK (length_of_stay BETWEEN 1 AND 120),
    CONSTRAINT chk_hist_money CHECK (total_charges_usd >= 0 AND total_costs_usd >= 0)
);
CREATE INDEX idx_hist_condition_severity ON historical_discharges (condition_id, severity_code);

-- Table 18: Insurance schemes the counselling desk can apply
CREATE TABLE insurance_schemes (
    scheme_code VARCHAR(10) PRIMARY KEY,
    scheme_name VARCHAR(80) NOT NULL,
    annual_cover_inr NUMERIC(12,2),
    cover_basis VARCHAR(60) NOT NULL,
    is_cashless BOOLEAN NOT NULL DEFAULT false,
    notes VARCHAR(300) NOT NULL,
    source_url TEXT,
    CONSTRAINT chk_scheme_code CHECK (scheme_code ~ '^[A-Z]{3,10}$'),
    CONSTRAINT chk_scheme_cover CHECK (annual_cover_inr IS NULL OR annual_cover_inr > 0)
);
INSERT INTO insurance_schemes VALUES
('SELF',    'Self-pay (no insurance)',  NULL,      'not applicable',            false, 'The family pays the full bill.', NULL),
('PMJAY',   'Ayushman Bharat PM-JAY',   500000.00, 'per family per year',       true,  'Central government scheme, cashless at empanelled hospitals. Confirm the family''s remaining balance at the scheme desk.', 'https://pmjay.gov.in'),
('CMCHIS',  'Tamil Nadu CMCHIS',        500000.00, 'per family per year',       true,  'Chief Minister''s Comprehensive Health Insurance Scheme (Tamil Nadu). Limits follow the current scheme notification.', 'https://www.cmchistn.com'),
('PRIVATE', 'Private health insurance', NULL,      'sum insured on the policy', false, 'Enter the remaining sum insured from the policy document.', NULL);

-- Link admissions to the catalogue (powers predicted discharge times on the bed board)
ALTER TABLE admissions
    ADD COLUMN condition_id INT REFERENCES condition_catalog(condition_id) ON DELETE SET NULL,
    ADD COLUMN apr_severity SMALLINT,
    ADD CONSTRAINT chk_apr_severity CHECK (apr_severity IS NULL OR apr_severity BETWEEN 1 AND 4);

UPDATE admissions SET condition_id = 14, apr_severity = 3 WHERE admission_id = 1; -- acute MI
UPDATE admissions SET condition_id = 26, apr_severity = 2 WHERE admission_id = 2; -- bronchiolitis (child)
UPDATE admissions SET condition_id = 16, apr_severity = 3 WHERE admission_id = 3; -- unstable angina & arrhythmia
UPDATE admissions SET condition_id = 3,  apr_severity = 4 WHERE admission_id = 4; -- polytrauma with shock

-- Materialized View: real length-of-stay percentiles and resource intensity per condition and severity.
-- severity_code 0 = all severities (fallback when a severity bucket has fewer than 30 real cases).
CREATE MATERIALIZED VIEW mv_condition_benchmarks AS
WITH baseline AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY total_costs_usd / GREATEST(length_of_stay, 1)) AS cost_per_day
    FROM historical_discharges
    WHERE total_costs_usd > 0
)
SELECT
    h.condition_id,
    COALESCE(h.severity_code, 0)::SMALLINT AS severity_code,
    count(*)::INT AS cases,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY h.length_of_stay)::NUMERIC(6,2) AS los_p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY h.length_of_stay)::NUMERIC(6,2) AS los_p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY h.length_of_stay)::NUMERIC(6,2) AS los_p75,
    percentile_cont(0.90) WITHIN GROUP (ORDER BY h.length_of_stay)::NUMERIC(6,2) AS los_p90,
    round(avg(h.length_of_stay), 2) AS los_mean,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY h.total_costs_usd / GREATEST(h.length_of_stay, 1))::NUMERIC, 2) AS cost_per_day_usd,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h.total_costs_usd / GREATEST(h.length_of_stay, 1)) / max(b.cost_per_day))::NUMERIC, 3) AS intensity_index,
    round(100.0 * avg(h.died_in_hospital::INT), 2) AS mortality_pct,
    round(100.0 * avg(h.ed_admission::INT), 1) AS via_emergency_pct,
    round(100.0 * avg((h.medical_surgical = 'Surgical')::INT), 1) AS surgical_pct
FROM historical_discharges h
CROSS JOIN baseline b
GROUP BY GROUPING SETS ((h.condition_id, h.severity_code), (h.condition_id))
WITH NO DATA;
CREATE UNIQUE INDEX uq_mv_condition_benchmarks ON mv_condition_benchmarks (condition_id, severity_code);

-- Function 3: Upfront cost estimate for a family, before admission.
--   Length of stay comes from real outcomes (P25 / P50 / P75 / P90 of matching real stays).
--   Prices come from this hospital's own ward tariff.
--   The real cost data only sets how resource-heavy the condition is compared with an average stay
--   (intensity_index), which scales the non-bed charges: total = days x tariff x (1 + intensity).
CREATE OR REPLACE FUNCTION fn_estimate_admission_cost(
    p_condition_id INT,
    p_severity INT,
    p_ward_type VARCHAR DEFAULT NULL,
    p_scheme_code VARCHAR DEFAULT 'SELF',
    p_cover_remaining NUMERIC DEFAULT NULL
)
RETURNS TABLE (
    condition_id INT,
    display_name VARCHAR,
    severity_used SMALLINT,
    cases INT,
    used_fallback BOOLEAN,
    los_low INT,
    los_typical INT,
    los_high INT,
    los_worst INT,
    intensity_index NUMERIC,
    ward_type VARCHAR,
    daily_tariff NUMERIC,
    est_low NUMERIC,
    est_typical NUMERIC,
    est_high NUMERIC,
    est_worst NUMERIC,
    scheme_code VARCHAR,
    scheme_name VARCHAR,
    cover_available NUMERIC,
    oop_low NUMERIC,
    oop_typical NUMERIC,
    oop_high NUMERIC,
    mortality_pct NUMERIC,
    source_population INT
)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
DECLARE
    c condition_catalog%ROWTYPE;
    bm mv_condition_benchmarks%ROWTYPE;
    s insurance_schemes%ROWTYPE;
    v_factor NUMERIC;
    v_ward VARCHAR;
    v_tariff NUMERIC;
BEGIN
    SELECT * INTO c FROM condition_catalog cc WHERE cc.condition_id = p_condition_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown condition id %', p_condition_id USING ERRCODE = 'P0002';
    END IF;
    IF p_severity IS NULL OR p_severity NOT BETWEEN 1 AND 4 THEN
        RAISE EXCEPTION 'Severity must be 1 (minor) to 4 (extreme)' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO bm FROM mv_condition_benchmarks m
    WHERE m.condition_id = p_condition_id AND m.severity_code = p_severity AND m.cases >= 30;
    used_fallback := NOT FOUND;
    IF used_fallback THEN
        SELECT * INTO bm FROM mv_condition_benchmarks m
        WHERE m.condition_id = p_condition_id AND m.severity_code = 0;
    END IF;
    IF bm.condition_id IS NULL THEN
        RAISE EXCEPTION 'No real-world benchmark loaded for this condition. Run npm run db:setup to load the datasets.'
            USING ERRCODE = 'P0002';
    END IF;

    v_ward := COALESCE(p_ward_type, c.default_ward_type);
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY wb.daily_tariff) INTO v_tariff
    FROM wards_beds wb WHERE wb.ward_type = v_ward AND wb.dept_id = c.dept_id;
    IF v_tariff IS NULL THEN
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY wb.daily_tariff) INTO v_tariff
        FROM wards_beds wb WHERE wb.ward_type = v_ward;
    END IF;
    IF v_tariff IS NULL THEN
        RAISE EXCEPTION 'This hospital has no % beds to price the stay', v_ward USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO s FROM insurance_schemes i WHERE i.scheme_code = upper(COALESCE(p_scheme_code, 'SELF'));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown insurance scheme %', p_scheme_code USING ERRCODE = 'P0002';
    END IF;

    condition_id := c.condition_id;
    display_name := c.display_name;
    severity_used := bm.severity_code;
    cases := bm.cases;
    los_low := GREATEST(1, ceil(bm.los_p25))::INT;
    los_typical := GREATEST(1, ceil(bm.los_p50))::INT;
    los_high := GREATEST(1, ceil(bm.los_p75))::INT;
    los_worst := GREATEST(1, ceil(bm.los_p90))::INT;
    intensity_index := round(LEAST(GREATEST(bm.intensity_index, 0.5), 4.0), 3);
    v_factor := 1 + intensity_index;
    ward_type := v_ward;
    daily_tariff := round(v_tariff::NUMERIC, 2);
    est_low := round(los_low * daily_tariff * v_factor, -2);
    est_typical := round(los_typical * daily_tariff * v_factor, -2);
    est_high := round(los_high * daily_tariff * v_factor, -2);
    est_worst := round(los_worst * daily_tariff * v_factor, -2);
    scheme_code := s.scheme_code;
    scheme_name := s.scheme_name;
    cover_available := CASE
        WHEN s.scheme_code = 'SELF' THEN 0
        WHEN p_cover_remaining IS NOT NULL THEN GREATEST(p_cover_remaining, 0)
        ELSE COALESCE(s.annual_cover_inr, 0)
    END;
    oop_low := GREATEST(est_low - cover_available, 0);
    oop_typical := GREATEST(est_typical - cover_available, 0);
    oop_high := GREATEST(est_high - cover_available, 0);
    mortality_pct := bm.mortality_pct;
    source_population := c.source_population;
    RETURN NEXT;
END;
$$;

-- Table 19: Cost estimates explained to families (later compared with the final bill)
CREATE TABLE cost_estimates (
    estimate_id SERIAL PRIMARY KEY,
    estimate_code VARCHAR(12) GENERATED ALWAYS AS ('EST-' || lpad(estimate_id::TEXT, 5, '0')) STORED,
    patient_id INT REFERENCES patients(patient_id) ON DELETE SET NULL,
    admission_id INT UNIQUE REFERENCES admissions(admission_id) ON DELETE SET NULL,
    condition_id INT NOT NULL REFERENCES condition_catalog(condition_id) ON DELETE RESTRICT,
    severity_code SMALLINT NOT NULL,
    ward_type VARCHAR(30) NOT NULL,
    scheme_code VARCHAR(10) NOT NULL REFERENCES insurance_schemes(scheme_code) ON DELETE RESTRICT,
    cover_available_inr NUMERIC(12,2) NOT NULL DEFAULT 0,
    cases_used INT NOT NULL,
    los_low INT NOT NULL,
    los_typical INT NOT NULL,
    los_high INT NOT NULL,
    daily_tariff NUMERIC(10,2) NOT NULL,
    intensity_index NUMERIC(6,3) NOT NULL,
    est_low_inr NUMERIC(12,2) NOT NULL,
    est_typical_inr NUMERIC(12,2) NOT NULL,
    est_high_inr NUMERIC(12,2) NOT NULL,
    oop_typical_inr NUMERIC(12,2) NOT NULL,
    explained_to VARCHAR(100),
    relation_to_patient VARCHAR(40),
    created_by_staff INT REFERENCES staff_accounts(staff_id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_est_severity CHECK (severity_code BETWEEN 1 AND 4),
    CONSTRAINT chk_est_order CHECK (est_low_inr <= est_typical_inr AND est_typical_inr <= est_high_inr),
    CONSTRAINT chk_est_los CHECK (los_low >= 1 AND los_low <= los_typical AND los_typical <= los_high),
    CONSTRAINT chk_est_oop CHECK (oop_typical_inr >= 0 AND oop_typical_inr <= est_typical_inr),
    CONSTRAINT chk_est_ward CHECK (ward_type IN ('General', 'Pediatric', 'Semi-Private', 'ICU', 'CCU', 'Burn-Unit'))
);

-- View 4: Was the estimate honest? Final bill vs the range the family was given.
CREATE OR REPLACE VIEW v_estimate_accuracy WITH (security_invoker = true) AS
SELECT
    e.estimate_id,
    e.estimate_code,
    e.admission_id,
    cc.display_name AS condition_name,
    e.est_low_inr,
    e.est_typical_inr,
    e.est_high_inr,
    b.bill_id,
    b.gross_amount AS actual_gross_inr,
    CASE
        WHEN b.bill_id IS NULL THEN 'Pending'
        WHEN b.gross_amount < e.est_low_inr THEN 'Below range'
        WHEN b.gross_amount > e.est_high_inr THEN 'Above range'
        ELSE 'Within range'
    END AS outcome,
    round(100.0 * (b.gross_amount - e.est_typical_inr) / NULLIF(e.est_typical_inr, 0), 1) AS deviation_pct
FROM cost_estimates e
JOIN condition_catalog cc ON cc.condition_id = e.condition_id
LEFT JOIN billing b ON b.admission_id = e.admission_id;

-- ============================================================================
-- 7. GOLDEN-HOUR AMBULANCE PRE-ALERTS, TIMED BED HOLDS & DIVERSION
--    A 108 / private ambulance crew calls ahead. PostgreSQL picks the best free bed and
--    holds it for exactly the ETA window. A hold expires by itself because the window is
--    a tsrange; no cron job needed. If nothing fits, the nearest emergency-capable hospitals
--    from the national directory are suggested.
-- ============================================================================

-- Table 20: Ambulance pre-alerts
CREATE TABLE ambulance_prealerts (
    alert_id SERIAL PRIMARY KEY,
    alert_code VARCHAR(12) GENERATED ALWAYS AS ('PA-' || lpad(alert_id::TEXT, 5, '0')) STORED,
    ambulance_reg VARCHAR(15) NOT NULL,
    service_type VARCHAR(15) NOT NULL DEFAULT '108',
    crew_phone VARCHAR(10) NOT NULL,
    origin_label VARCHAR(120) NOT NULL,
    origin_pincode CHAR(6) REFERENCES india_pincodes(pincode) ON DELETE SET NULL,
    origin_lat NUMERIC(9,6) NOT NULL,
    origin_lon NUMERIC(9,6) NOT NULL,
    distance_km NUMERIC(7,2),
    patient_age INT,
    patient_gender CHAR(1) NOT NULL DEFAULT 'U',
    chief_complaint VARCHAR(200) NOT NULL,
    condition_id INT REFERENCES condition_catalog(condition_id) ON DELETE SET NULL,
    esi_level INT NOT NULL,
    heart_rate INT,
    spo2 INT,
    systolic_bp INT,
    gcs INT,
    needs_ventilator BOOLEAN NOT NULL DEFAULT false,
    required_ward_type VARCHAR(30),
    eta_minutes INT NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'Incoming',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expected_arrival_at TIMESTAMP GENERATED ALWAYS AS (created_at + make_interval(mins => eta_minutes)) STORED,
    resolved_at TIMESTAMP,
    admission_id INT REFERENCES admissions(admission_id) ON DELETE SET NULL,
    diverted_to_nhp_id INT REFERENCES nhp_hospitals(nhp_id) ON DELETE SET NULL,
    resolution_note VARCHAR(255),
    created_by_staff INT REFERENCES staff_accounts(staff_id) ON DELETE SET NULL,
    CONSTRAINT chk_ambulance_reg CHECK (ambulance_reg ~ '^[A-Z]{2}-[0-9]{2}-[A-Z]{1,3}-[0-9]{4}$'),
    CONSTRAINT chk_service_type CHECK (service_type IN ('108', 'Private', 'Inter-facility')),
    CONSTRAINT chk_crew_phone CHECK (crew_phone ~ '^[0-9]{10}$'),
    CONSTRAINT chk_origin_geo CHECK (origin_lat BETWEEN 6 AND 37.6 AND origin_lon BETWEEN 68 AND 97.5),
    CONSTRAINT chk_alert_age CHECK (patient_age IS NULL OR patient_age BETWEEN 0 AND 120),
    CONSTRAINT chk_alert_gender CHECK (patient_gender IN ('M', 'F', 'O', 'U')),
    CONSTRAINT chk_alert_esi CHECK (esi_level BETWEEN 1 AND 5),
    CONSTRAINT chk_alert_vitals CHECK (
        (heart_rate IS NULL OR heart_rate BETWEEN 20 AND 250) AND
        (spo2 IS NULL OR spo2 BETWEEN 40 AND 100) AND
        (systolic_bp IS NULL OR systolic_bp BETWEEN 40 AND 260) AND
        (gcs IS NULL OR gcs BETWEEN 3 AND 15)
    ),
    CONSTRAINT chk_alert_ward CHECK (
        required_ward_type IS NULL OR required_ward_type IN ('General', 'Pediatric', 'Semi-Private', 'ICU', 'CCU', 'Burn-Unit')
    ),
    CONSTRAINT chk_alert_eta CHECK (eta_minutes BETWEEN 1 AND 240),
    CONSTRAINT chk_alert_status CHECK (status IN ('Incoming', 'Arrived', 'Diverted', 'Cancelled', 'Expired')),
    CONSTRAINT chk_alert_resolution CHECK ((status = 'Incoming') = (resolved_at IS NULL)),
    CONSTRAINT chk_alert_arrival CHECK (status <> 'Arrived' OR admission_id IS NOT NULL),
    CONSTRAINT chk_alert_diversion CHECK (status <> 'Diverted' OR length(trim(coalesce(resolution_note, ''))) >= 5)
);
CREATE INDEX idx_alerts_status_eta ON ambulance_prealerts (status, expected_arrival_at);

-- Table 21: Timed bed holds. A hold lives only inside its tsrange window.
CREATE TABLE bed_holds (
    hold_id SERIAL PRIMARY KEY,
    alert_id INT NOT NULL REFERENCES ambulance_prealerts(alert_id) ON DELETE CASCADE,
    bed_id INT NOT NULL REFERENCES wards_beds(bed_id) ON DELETE RESTRICT,
    hold_window tsrange NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'Active',
    released_reason VARCHAR(120),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_hold_status CHECK (status IN ('Active', 'Converted', 'Released')),
    CONSTRAINT chk_hold_window CHECK (
        NOT isempty(hold_window) AND upper(hold_window) - lower(hold_window) <= INTERVAL '4 hours 30 minutes'
    ),
    CONSTRAINT chk_hold_release_reason CHECK (status <> 'Released' OR released_reason IS NOT NULL),
    -- Two ambulances can never be promised the same bed for overlapping windows
    CONSTRAINT ex_no_double_bed_hold EXCLUDE USING gist (
        bed_id WITH =,
        hold_window WITH &&
    ) WHERE (status = 'Active')
);
CREATE UNIQUE INDEX uq_one_active_hold_per_alert ON bed_holds (alert_id) WHERE status = 'Active';

-- Function 4: great-circle distance in km (haversine)
CREATE OR REPLACE FUNCTION fn_haversine_km(lat1 NUMERIC, lon1 NUMERIC, lat2 NUMERIC, lon2 NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT round((2 * 6371 * asin(sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
    )))::NUMERIC, 2)
$$;

-- Function 5: suggested ETA from a position (road factor 1.3, 40 km/h average, 2 min to load)
CREATE OR REPLACE FUNCTION fn_suggest_eta_minutes(p_lat NUMERIC, p_lon NUMERIC)
RETURNS TABLE (distance_km NUMERIC, eta_minutes INT)
LANGUAGE sql
STABLE
AS $$
    SELECT d.km, LEAST(240, GREATEST(3, ceil(d.km * 1.3 / 40.0 * 60.0) + 2))::INT
    FROM (SELECT fn_haversine_km(p_lat, p_lon, hp.latitude, hp.longitude) AS km FROM hospital_profile hp) d
$$;

-- Trigger guard 1: a hold may only be placed on a bed that is free for the whole window.
-- SECURITY DEFINER so the check sees every admission, even rows hidden from the caller by RLS.
CREATE OR REPLACE FUNCTION trg_fn_bed_hold_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status VARCHAR;
BEGIN
    IF NEW.status <> 'Active' THEN
        RETURN NEW;
    END IF;
    SELECT operational_status INTO v_status FROM wards_beds WHERE bed_id = NEW.bed_id FOR UPDATE;
    IF v_status IS DISTINCT FROM 'Available' OR EXISTS (
        SELECT 1 FROM admissions a WHERE a.bed_id = NEW.bed_id AND a.stay_duration_range && NEW.hold_window
    ) THEN
        RAISE EXCEPTION 'Bed % is not free for the whole ambulance hold window.', NEW.bed_id
            USING ERRCODE = '23514', CONSTRAINT = 'chk_hold_bed_free';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bed_hold_guard
BEFORE INSERT OR UPDATE OF bed_id, hold_window, status ON bed_holds
FOR EACH ROW
EXECUTE FUNCTION trg_fn_bed_hold_guard();

-- Trigger guard 2: nobody can admit a walk-in patient into a bed promised to an incoming ambulance.
CREATE OR REPLACE FUNCTION trg_fn_admission_hold_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hold RECORD;
BEGIN
    SELECT h.hold_id, p.alert_code, p.expected_arrival_at INTO v_hold
    FROM bed_holds h
    JOIN ambulance_prealerts p ON p.alert_id = h.alert_id
    WHERE h.bed_id = NEW.bed_id
      AND h.status = 'Active'
      AND h.hold_window && tsrange(NEW.admission_time, COALESCE(NEW.discharge_time, 'infinity'::TIMESTAMP), '[)')
      AND upper(h.hold_window) > LOCALTIMESTAMP
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'This bed is held for incoming ambulance % (expected %).',
            v_hold.alert_code, to_char(v_hold.expected_arrival_at, 'HH24:MI')
            USING ERRCODE = '23P01', CONSTRAINT = 'ex_bed_held_for_ambulance';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_admission_hold_guard
BEFORE INSERT OR UPDATE OF bed_id ON admissions
FOR EACH ROW
EXECUTE FUNCTION trg_fn_admission_hold_guard();

-- Function 6: holds that are live right now (masked for the billing desk)
CREATE OR REPLACE FUNCTION fn_active_bed_holds()
RETURNS TABLE (
    bed_id INT,
    hold_id INT,
    alert_id INT,
    alert_code VARCHAR,
    ambulance_reg VARCHAR,
    hold_until TIMESTAMP,
    expected_arrival_at TIMESTAMP,
    esi_level INT,
    chief_complaint VARCHAR,
    origin_label VARCHAR
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT h.bed_id, h.hold_id, p.alert_id, p.alert_code, p.ambulance_reg, upper(h.hold_window), p.expected_arrival_at,
           CASE WHEN coalesce(current_setting('app.staff_role', true), '') = 'Billing' THEN NULL ELSE p.esi_level END,
           CASE WHEN coalesce(current_setting('app.staff_role', true), '') = 'Billing' THEN NULL ELSE p.chief_complaint END,
           p.origin_label
    FROM bed_holds h
    JOIN ambulance_prealerts p ON p.alert_id = h.alert_id
    WHERE h.status = 'Active' AND h.hold_window @> LOCALTIMESTAMP
$$;

-- View 5: the bed board every screen reads ("Reserved" = held for an ambulance)
CREATE OR REPLACE VIEW v_bed_board WITH (security_invoker = true) AS
SELECT
    b.bed_id,
    b.dept_id,
    b.room_number,
    b.bed_label,
    b.ward_type,
    b.has_ventilator,
    b.has_oxygen_port,
    b.daily_tariff,
    b.operational_status,
    CASE WHEN h.hold_id IS NOT NULL AND b.operational_status = 'Available' THEN 'Reserved' ELSE b.operational_status END AS board_status,
    d.dept_code,
    d.dept_name,
    d.floor_number,
    h.hold_id,
    h.alert_code AS hold_alert_code,
    h.ambulance_reg AS hold_ambulance,
    h.hold_until,
    h.expected_arrival_at AS hold_eta,
    h.esi_level AS hold_esi,
    h.chief_complaint AS hold_complaint,
    h.origin_label AS hold_origin
FROM wards_beds b
JOIN departments d ON d.dept_id = b.dept_id
LEFT JOIN fn_active_bed_holds() h ON h.bed_id = b.bed_id;

-- Function 7: pick and hold the best bed for a pre-alert
CREATE OR REPLACE FUNCTION fn_reserve_bed_for_alert(p_alert_id INT)
RETURNS TABLE (
    hold_id INT,
    bed_id INT,
    room_number VARCHAR,
    bed_label VARCHAR,
    ward_type VARCHAR,
    dept_name VARCHAR,
    hold_until TIMESTAMP,
    match_quality VARCHAR
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    a ambulance_prealerts%ROWTYPE;
    v_target VARCHAR;
    v_dept INT;
    v_need_vent BOOLEAN;
    v_window tsrange;
    v_bed RECORD;
    v_hold INT;
BEGIN
    SELECT * INTO a FROM ambulance_prealerts p WHERE p.alert_id = p_alert_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pre-alert % does not exist', p_alert_id USING ERRCODE = 'P0002';
    END IF;
    IF a.status <> 'Incoming' THEN
        RAISE EXCEPTION 'Pre-alert % is already %', a.alert_code, a.status USING ERRCODE = '22000';
    END IF;
    IF EXISTS (SELECT 1 FROM bed_holds h WHERE h.alert_id = p_alert_id AND h.status = 'Active' AND upper(h.hold_window) > LOCALTIMESTAMP) THEN
        RAISE EXCEPTION 'Pre-alert % already has a bed on hold', a.alert_code USING ERRCODE = '22000';
    END IF;

    SELECT cc.default_ward_type, cc.dept_id INTO v_target, v_dept
    FROM condition_catalog cc WHERE cc.condition_id = a.condition_id;
    v_target := COALESCE(a.required_ward_type, v_target, CASE WHEN a.esi_level <= 2 THEN 'ICU' ELSE 'General' END);
    v_dept := COALESCE(v_dept, CASE WHEN a.patient_age < 18 THEN 4 ELSE 1 END);
    v_need_vent := a.needs_ventilator OR a.esi_level = 1;
    IF v_need_vent AND v_target NOT IN ('ICU', 'CCU') THEN
        v_target := 'ICU';
    END IF;
    v_window := tsrange(LOCALTIMESTAMP, a.expected_arrival_at + INTERVAL '20 minutes', '[)');

    SELECT b.bed_id, b.room_number, b.bed_label, b.ward_type, b.dept_id, d.dept_name INTO v_bed
    FROM wards_beds b
    JOIN departments d ON d.dept_id = b.dept_id
    WHERE b.operational_status = 'Available'
      AND NOT EXISTS (SELECT 1 FROM admissions x WHERE x.bed_id = b.bed_id AND x.stay_duration_range && v_window)
      AND NOT EXISTS (SELECT 1 FROM bed_holds h WHERE h.bed_id = b.bed_id AND h.status = 'Active' AND h.hold_window && v_window)
      AND (NOT v_need_vent OR b.has_ventilator)
      AND CASE v_target
            WHEN 'ICU' THEN b.ward_type IN ('ICU', 'CCU')
            WHEN 'CCU' THEN b.ward_type IN ('CCU', 'ICU')
            WHEN 'General' THEN b.ward_type IN ('General', 'Semi-Private')
            WHEN 'Semi-Private' THEN b.ward_type IN ('Semi-Private', 'General')
            ELSE b.ward_type = v_target
          END
    ORDER BY (b.ward_type = v_target) DESC, (b.dept_id = v_dept) DESC, b.daily_tariff ASC, b.bed_id ASC
    LIMIT 1
    FOR UPDATE OF b SKIP LOCKED;

    IF NOT FOUND THEN
        RETURN; -- no bed: caller shows diversion options
    END IF;

    INSERT INTO bed_holds (alert_id, bed_id, hold_window)
    VALUES (p_alert_id, v_bed.bed_id, v_window)
    RETURNING bed_holds.hold_id INTO v_hold;

    hold_id := v_hold;
    bed_id := v_bed.bed_id;
    room_number := v_bed.room_number;
    bed_label := v_bed.bed_label;
    ward_type := v_bed.ward_type;
    dept_name := v_bed.dept_name;
    hold_until := upper(v_window);
    match_quality := CASE
        WHEN v_bed.ward_type = v_target AND v_bed.dept_id = v_dept THEN 'exact'
        WHEN v_bed.ward_type = v_target THEN 'ward'
        ELSE 'compatible'
    END;
    RETURN NEXT;
END;
$$;

-- Function 8: lazy expiry. Closes holds whose window has ended and alerts that never arrived.
CREATE OR REPLACE FUNCTION fn_release_expired_holds()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_holds INT;
    v_alerts INT;
BEGIN
    UPDATE bed_holds
    SET status = 'Released', released_reason = 'Hold window ended before the ambulance arrived'
    WHERE status = 'Active' AND upper(hold_window) <= LOCALTIMESTAMP;
    GET DIAGNOSTICS v_holds = ROW_COUNT;

    UPDATE ambulance_prealerts
    SET status = 'Expired', resolved_at = LOCALTIMESTAMP, resolution_note = 'No arrival within 20 minutes of the ETA'
    WHERE status = 'Incoming' AND expected_arrival_at + INTERVAL '20 minutes' <= LOCALTIMESTAMP;
    GET DIAGNOSTICS v_alerts = ROW_COUNT;

    RETURN v_holds + v_alerts;
END;
$$;

-- Function 9: ambulance arrives, hold becomes an admission in one atomic step
CREATE OR REPLACE FUNCTION fn_admit_from_alert(
    p_alert_id INT,
    p_patient_id INT,
    p_doctor_id INT,
    p_diagnosis TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    a ambulance_prealerts%ROWTYPE;
    v_hold bed_holds%ROWTYPE;
    v_admission INT;
BEGIN
    SELECT * INTO a FROM ambulance_prealerts WHERE alert_id = p_alert_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pre-alert % does not exist', p_alert_id USING ERRCODE = 'P0002';
    END IF;
    IF a.status <> 'Incoming' THEN
        RAISE EXCEPTION 'Pre-alert % is already %', a.alert_code, a.status USING ERRCODE = '22000';
    END IF;

    SELECT * INTO v_hold FROM bed_holds
    WHERE alert_id = p_alert_id AND status = 'Active' AND upper(hold_window) > LOCALTIMESTAMP
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pre-alert % has no live bed hold. Reserve a bed first or use the admission desk.', a.alert_code
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE bed_holds SET status = 'Converted' WHERE hold_id = v_hold.hold_id;

    INSERT INTO admissions (patient_id, bed_id, admitting_doctor_id, triage_priority, admission_status,
                            admission_diagnosis, condition_id, apr_severity)
    VALUES (p_patient_id, v_hold.bed_id, p_doctor_id, a.esi_level, 'Admitted',
            COALESCE(NULLIF(trim(p_diagnosis), ''), a.chief_complaint), a.condition_id,
            CASE a.esi_level WHEN 1 THEN 4 WHEN 2 THEN 3 WHEN 3 THEN 2 ELSE 1 END)
    RETURNING admission_id INTO v_admission;

    UPDATE ambulance_prealerts
    SET status = 'Arrived', resolved_at = LOCALTIMESTAMP, admission_id = v_admission
    WHERE alert_id = p_alert_id;

    RETURN v_admission;
END;
$$;

-- Function 10: nearest emergency-capable hospitals from the national directory (bounding box + haversine)
CREATE OR REPLACE FUNCTION fn_nearest_er_hospitals(
    p_lat NUMERIC,
    p_lon NUMERIC,
    p_limit INT DEFAULT 8,
    p_radius_km NUMERIC DEFAULT 60
)
RETURNS TABLE (
    nhp_id INT,
    hospital_name VARCHAR,
    care_type VARCHAR,
    hospital_category VARCHAR,
    district VARCHAR,
    state VARCHAR,
    pincode CHAR(6),
    phone VARCHAR,
    total_beds INT,
    distance_km NUMERIC,
    geo_source VARCHAR,
    latitude NUMERIC,
    longitude NUMERIC
)
LANGUAGE sql
STABLE
AS $$
    SELECT h.nhp_id, h.hospital_name, h.care_type, h.hospital_category, h.district, h.state, h.pincode,
           COALESCE(h.emergency_phone, h.ambulance_phone, h.telephone, h.mobile),
           h.total_beds,
           fn_haversine_km(p_lat, p_lon, h.latitude, h.longitude) AS distance_km,
           h.geo_source, h.latitude, h.longitude
    FROM nhp_hospitals h
    WHERE h.er_capable
      AND h.latitude BETWEEN p_lat - p_radius_km / 111.0 AND p_lat + p_radius_km / 111.0
      AND h.longitude BETWEEN p_lon - p_radius_km / (111.0 * cos(radians(p_lat)))
                          AND p_lon + p_radius_km / (111.0 * cos(radians(p_lat)))
    ORDER BY distance_km ASC, h.total_beds DESC NULLS LAST, h.nhp_id
    LIMIT p_limit
$$;

-- Live feed: every change worth showing on a screen is pushed with LISTEN/NOTIFY (no patient names in payloads)
CREATE OR REPLACE FUNCTION trg_fn_live_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_payload JSONB := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP);
BEGIN
    IF TG_TABLE_NAME = 'ambulance_prealerts' THEN
        v_payload := v_payload || jsonb_build_object(
            'alert_code', NEW.alert_code, 'status', NEW.status, 'esi', NEW.esi_level,
            'eta', NEW.expected_arrival_at, 'origin', NEW.origin_label, 'ambulance', NEW.ambulance_reg);
    ELSIF TG_TABLE_NAME = 'bed_holds' THEN
        v_payload := v_payload || jsonb_build_object('bed_id', NEW.bed_id, 'status', NEW.status);
    ELSIF TG_TABLE_NAME = 'wards_beds' THEN
        v_payload := v_payload || jsonb_build_object('bed_id', NEW.bed_id, 'status', NEW.operational_status);
    ELSIF TG_TABLE_NAME = 'admissions' THEN
        v_payload := v_payload || jsonb_build_object('bed_id', NEW.bed_id, 'status', NEW.admission_status);
    END IF;
    PERFORM pg_notify('mediresource_live', v_payload::TEXT);
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_live_prealerts AFTER INSERT OR UPDATE ON ambulance_prealerts
FOR EACH ROW EXECUTE FUNCTION trg_fn_live_notify();
CREATE TRIGGER trg_live_bed_holds AFTER INSERT OR UPDATE ON bed_holds
FOR EACH ROW EXECUTE FUNCTION trg_fn_live_notify();
CREATE TRIGGER trg_live_admissions AFTER INSERT OR UPDATE ON admissions
FOR EACH ROW EXECUTE FUNCTION trg_fn_live_notify();
CREATE TRIGGER trg_live_beds AFTER UPDATE OF operational_status ON wards_beds
FOR EACH ROW WHEN (OLD.operational_status IS DISTINCT FROM NEW.operational_status)
EXECUTE FUNCTION trg_fn_live_notify();

-- ============================================================================
-- 8. ROLE-BASED PRIVACY ENFORCED BY POSTGRESQL (roles, column grants, row-level security)
--    Each API request runs inside a transaction that does
--        SET LOCAL ROLE mr_<role>;  SELECT set_config('app.staff_id', ..., true) ...
--    so PostgreSQL itself decides which rows and columns the signed-in staff member may touch.
-- ============================================================================

-- Restricted records: medico-legal cases, VIPs, sensitive diagnoses
ALTER TABLE patients
    ADD COLUMN privacy_level VARCHAR(12) NOT NULL DEFAULT 'standard',
    ADD COLUMN restriction_reason VARCHAR(80),
    ADD CONSTRAINT chk_privacy_level CHECK (privacy_level IN ('standard', 'restricted')),
    ADD CONSTRAINT chk_restriction_reason CHECK (
        privacy_level = 'standard' OR length(trim(coalesce(restriction_reason, ''))) >= 3
    );

-- Road-traffic accidents are medico-legal cases (MLC) in India: visible only to the care team
UPDATE patients
SET privacy_level = 'restricted', restriction_reason = 'Medico-legal case (road traffic accident)'
WHERE patient_id = 4;

-- One database role per staff role (cluster-wide, so create only if missing)
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['mr_doctor', 'mr_nurse', 'mr_billing', 'mr_admin'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
        BEGIN
            EXECUTE format('GRANT %I TO %I', r, current_user);
        EXCEPTION WHEN others THEN
            NULL; -- superusers can SET ROLE without membership
        END;
    END LOOP;
END $$;

-- Session context helpers (values are set per transaction by lib/db.ts)
CREATE OR REPLACE FUNCTION app_role() RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('app.staff_role', true), ''), 'none')
$$;
CREATE OR REPLACE FUNCTION app_staff_id() RETURNS INT LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.staff_id', true), '')::INT
$$;
CREATE OR REPLACE FUNCTION app_doctor_id() RETURNS INT LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.doctor_id', true), '')::INT
$$;
CREATE OR REPLACE FUNCTION app_break_glass() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT coalesce(current_setting('app.access_mode', true), '') = 'break_glass'
$$;

-- Who may see a patient? SECURITY DEFINER so the lookup itself is not filtered (avoids policy recursion).
CREATE OR REPLACE FUNCTION fn_can_see_patient(p_patient_id INT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT app_role() IN ('Admin', 'Billing')
        OR app_break_glass()
        OR NOT EXISTS (
            SELECT 1 FROM patients p WHERE p.patient_id = p_patient_id AND p.privacy_level = 'restricted'
        )
        OR EXISTS (
            SELECT 1 FROM admissions a WHERE a.patient_id = p_patient_id AND a.admitting_doctor_id = app_doctor_id()
        )
$$;

-- How many current inpatients are hidden from the caller? (a count only, never who)
CREATE OR REPLACE FUNCTION fn_hidden_active_admissions()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT count(*)::INT FROM admissions a
    WHERE a.discharge_time IS NULL AND a.admission_status = 'Admitted'
      AND NOT (fn_can_see_patient(a.patient_id) OR a.admitting_doctor_id = app_doctor_id())
$$;

-- Views read the caller's privileges and policies, not the owner's
ALTER VIEW V_Live_Bed_Availability SET (security_invoker = true);
ALTER VIEW V_Pending_Discharge_Summary SET (security_invoker = true);
ALTER VIEW V_Department_Occupancy_Summary SET (security_invoker = true);

-- ---------- Privileges ----------
GRANT USAGE ON SCHEMA public TO mr_doctor, mr_nurse, mr_billing, mr_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mr_doctor, mr_nurse, mr_billing, mr_admin;

-- Everyone: reference data, the bed board, real-world datasets
GRANT SELECT ON departments, doctors, wards_beds, condition_catalog, historical_discharges, insurance_schemes,
                nhp_hospitals, india_pincodes, hospital_profile, dataset_sources, mv_condition_benchmarks,
                v_bed_board, V_Department_Occupancy_Summary
    TO mr_doctor, mr_nurse, mr_billing, mr_admin;
GRANT UPDATE (operational_status) ON wards_beds TO mr_doctor, mr_nurse, mr_billing, mr_admin;
GRANT SELECT, INSERT, UPDATE ON cost_estimates TO mr_doctor, mr_nurse, mr_billing, mr_admin;
GRANT SELECT ON v_estimate_accuracy TO mr_doctor, mr_nurse, mr_billing, mr_admin; -- still needs billing access underneath
GRANT SELECT ON login_audit TO mr_doctor, mr_nurse, mr_billing, mr_admin;

-- Clinical team (doctors, nurses) and administrators: full clinical record
GRANT SELECT, INSERT ON patients TO mr_doctor, mr_nurse, mr_admin;
GRANT UPDATE (privacy_level, restriction_reason, primary_phone, emergency_contact_name, emergency_contact_phone)
    ON patients TO mr_doctor, mr_admin;
GRANT SELECT, INSERT, UPDATE ON admissions TO mr_doctor, mr_nurse, mr_admin;
GRANT SELECT, INSERT ON bed_transfer_audit TO mr_doctor, mr_nurse, mr_admin;
GRANT SELECT ON medical_equipments, V_Live_Bed_Availability TO mr_doctor, mr_nurse, mr_admin;
GRANT SELECT, INSERT, UPDATE ON ambulance_prealerts, bed_holds TO mr_doctor, mr_nurse, mr_admin;

-- Billing desk: demographics and stay timing to raise the bill. No diagnosis, no triage (column-level grant).
GRANT SELECT ON patients TO mr_billing;
GRANT SELECT (admission_id, patient_id, bed_id, admitting_doctor_id, admission_time, discharge_time,
              stay_duration_range, admission_status)
    ON admissions TO mr_billing;
GRANT UPDATE (admission_status, discharge_time) ON admissions TO mr_billing;
GRANT SELECT, INSERT, UPDATE ON billing TO mr_billing, mr_admin;
GRANT SELECT ON V_Pending_Discharge_Summary TO mr_billing, mr_admin;

-- Administrators: staff directory without PIN hashes
GRANT SELECT (staff_id, staff_code, full_name, staff_role, doctor_id, is_active, created_at)
    ON staff_accounts TO mr_admin;

-- ---------- Row-level security policies ----------
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_patients_read ON patients FOR SELECT
    USING (fn_can_see_patient(patient_id));
CREATE POLICY pol_patients_register ON patients FOR INSERT
    WITH CHECK (app_role() IN ('Doctor', 'Nurse', 'Admin')
                AND (privacy_level = 'standard' OR app_role() IN ('Doctor', 'Admin')));
CREATE POLICY pol_patients_update ON patients FOR UPDATE
    USING (fn_can_see_patient(patient_id))
    WITH CHECK (app_role() IN ('Doctor', 'Admin'));

ALTER TABLE admissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_admissions_read ON admissions FOR SELECT
    USING (fn_can_see_patient(patient_id) OR admitting_doctor_id = app_doctor_id());
CREATE POLICY pol_admissions_admit ON admissions FOR INSERT
    WITH CHECK (app_role() IN ('Doctor', 'Nurse', 'Admin'));
CREATE POLICY pol_admissions_update ON admissions FOR UPDATE
    USING (fn_can_see_patient(patient_id) OR admitting_doctor_id = app_doctor_id());

ALTER TABLE cost_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_estimates_read ON cost_estimates FOR SELECT
    USING (patient_id IS NULL OR fn_can_see_patient(patient_id));
CREATE POLICY pol_estimates_create ON cost_estimates FOR INSERT
    WITH CHECK (created_by_staff = app_staff_id());
CREATE POLICY pol_estimates_link ON cost_estimates FOR UPDATE
    USING (patient_id IS NULL OR fn_can_see_patient(patient_id));

ALTER TABLE login_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_login_audit_read ON login_audit FOR SELECT
    USING (app_role() = 'Admin' OR staff_id = app_staff_id());

-- ============================================================================
-- 9. TAMPER-EVIDENT AUDIT CHAIN (SHA-256 hash chain, append-only)
--    Every change to a patient, admission, bill, bed status, ambulance hold, cost estimate or
--    login event appends one row. Each row stores the hash of the row before it, so editing or
--    deleting any old row breaks every seal after it. fn_verify_audit_chain() finds the break.
-- ============================================================================

-- Table 22: The chain itself
CREATE TABLE audit_chain (
    seq BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMP NOT NULL,
    staff_id INT,
    staff_code VARCHAR(20),
    staff_role VARCHAR(20),
    access_mode VARCHAR(15),
    db_role TEXT NOT NULL,
    table_name TEXT NOT NULL,
    operation VARCHAR(6) NOT NULL,
    record_pk TEXT NOT NULL,
    old_data JSONB,
    new_data JSONB,
    prev_hash CHAR(64) NOT NULL,
    row_hash CHAR(64) NOT NULL UNIQUE,
    CONSTRAINT chk_audit_op CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE', 'EVENT')),
    CONSTRAINT chk_audit_hashes CHECK (prev_hash ~ '^[0-9a-f]{64}$' AND row_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX idx_audit_chain_record ON audit_chain (table_name, record_pk, seq DESC);

-- Table 23: Tamper drills (admin training: simulate a rogue edit, then restore it)
CREATE TABLE audit_tamper_drill (
    drill_id SERIAL PRIMARY KEY,
    seq BIGINT NOT NULL REFERENCES audit_chain(seq) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    original_new_data JSONB NOT NULL,
    tampered_new_data JSONB NOT NULL,
    performed_by VARCHAR(20) NOT NULL,
    performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    restored_at TIMESTAMP
);

-- Function 11: the seal. Field order and timestamp format are fixed so the hash is reproducible.
CREATE OR REPLACE FUNCTION fn_audit_hash(
    p_prev CHAR(64), p_seq BIGINT, p_at TIMESTAMP, p_staff_code TEXT, p_staff_role TEXT, p_mode TEXT,
    p_db_role TEXT, p_table TEXT, p_op TEXT, p_pk TEXT, p_old JSONB, p_new JSONB
)
RETURNS CHAR(64)
LANGUAGE sql
STABLE
AS $$
    SELECT encode(digest(concat_ws('|',
        p_prev, p_seq::TEXT, to_char(p_at, 'YYYY-MM-DD"T"HH24:MI:SS.US'),
        coalesce(p_staff_code, '-'), coalesce(p_staff_role, '-'), coalesce(p_mode, '-'), p_db_role,
        p_table, p_op, p_pk, coalesce(p_old::TEXT, 'null'), coalesce(p_new::TEXT, 'null')
    ), 'sha256'), 'hex')
$$;

-- Function 12: append one sealed row. An advisory lock serialises writers so the chain never forks.
CREATE OR REPLACE FUNCTION fn_audit_append(p_table TEXT, p_op TEXT, p_pk TEXT, p_old JSONB, p_new JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_prev CHAR(64);
    v_seq BIGINT;
    v_at TIMESTAMP := clock_timestamp()::TIMESTAMP;
    v_code TEXT := nullif(current_setting('app.staff_code', true), '');
    v_role TEXT := nullif(current_setting('app.staff_role', true), '');
    v_mode TEXT := nullif(current_setting('app.access_mode', true), '');
    v_staff INT := nullif(current_setting('app.staff_id', true), '')::INT;
    v_db_role TEXT := CASE WHEN current_setting('role') = 'none' THEN session_user::TEXT ELSE current_setting('role') END;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('mediresource_audit_chain'));
    SELECT c.row_hash INTO v_prev FROM audit_chain c ORDER BY c.seq DESC LIMIT 1;
    v_prev := coalesce(v_prev, repeat('0', 64));
    v_seq := nextval(pg_get_serial_sequence('audit_chain', 'seq'));
    INSERT INTO audit_chain (seq, occurred_at, staff_id, staff_code, staff_role, access_mode, db_role,
                             table_name, operation, record_pk, old_data, new_data, prev_hash, row_hash)
    VALUES (v_seq, v_at, v_staff, v_code, v_role, v_mode, v_db_role, p_table, p_op, p_pk, p_old, p_new, v_prev,
            fn_audit_hash(v_prev, v_seq, v_at, v_code, v_role, v_mode, v_db_role, p_table, p_op, p_pk, p_old, p_new));
    RETURN v_seq;
END;
$$;
REVOKE EXECUTE ON FUNCTION fn_audit_append(TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;

-- Generic row trigger (TG_ARGV[0] = primary key column)
CREATE OR REPLACE FUNCTION trg_fn_audit_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old JSONB;
    v_new JSONB;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;
    PERFORM fn_audit_append(TG_TABLE_NAME, TG_OP, coalesce(v_new, v_old) ->> TG_ARGV[0], v_old, v_new);
    RETURN NULL;
END;
$$;

-- Append-only: UPDATE, DELETE and TRUNCATE are refused, even for the table owner
CREATE OR REPLACE FUNCTION trg_fn_audit_chain_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_chain is append-only: % is not allowed', TG_OP USING ERRCODE = '42501';
END;
$$;

-- View 6: every row re-checked: does its seal still match, and does it link to the row before it?
CREATE OR REPLACE VIEW v_audit_chain_verified WITH (security_invoker = true) AS
SELECT
    c.*,
    c.row_hash = fn_audit_hash(c.prev_hash, c.seq, c.occurred_at, c.staff_code, c.staff_role, c.access_mode,
                               c.db_role, c.table_name, c.operation, c.record_pk, c.old_data, c.new_data) AS seal_ok,
    c.prev_hash = coalesce(lag(c.row_hash) OVER (ORDER BY c.seq), repeat('0', 64)) AS link_ok
FROM audit_chain c;

-- Function 13: verify the whole chain. Any role may run it; it returns no record contents.
CREATE OR REPLACE FUNCTION fn_verify_audit_chain()
RETURNS TABLE (
    total_rows BIGINT,
    verified_rows BIGINT,
    first_bad_seq BIGINT,
    problem TEXT,
    head_seq BIGINT,
    head_hash CHAR(64),
    checked_at TIMESTAMP
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH v AS (SELECT seq, seal_ok, link_ok, row_hash FROM v_audit_chain_verified),
    bad AS (SELECT seq, seal_ok, link_ok FROM v WHERE NOT (seal_ok AND link_ok) ORDER BY seq LIMIT 1),
    head AS (SELECT seq, row_hash FROM v ORDER BY seq DESC LIMIT 1)
    SELECT
        (SELECT count(*) FROM v),
        (SELECT count(*) FROM v WHERE seq < coalesce((SELECT seq FROM bad), 9223372036854775807)),
        (SELECT seq FROM bad),
        (SELECT CASE
            WHEN NOT seal_ok THEN 'Row #' || seq || ' was changed after it was sealed: its contents no longer match its SHA-256 seal.'
            ELSE 'Row #' || seq || ' does not link to the row before it: a row was deleted, inserted or re-ordered.'
         END FROM bad),
        (SELECT seq FROM head),
        (SELECT row_hash FROM head),
        clock_timestamp()::TIMESTAMP
$$;

-- Function 14: the latest seal for one record (printed on discharge receipts)
CREATE OR REPLACE FUNCTION fn_audit_seal(p_table TEXT, p_pk TEXT)
RETURNS TABLE (seq BIGINT, row_hash CHAR(64), occurred_at TIMESTAMP)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT c.seq, c.row_hash, c.occurred_at FROM audit_chain c
    WHERE c.table_name = p_table AND c.record_pk = p_pk
    ORDER BY c.seq DESC LIMIT 1
$$;

-- Function 15: check a seal someone was given (e.g. printed on a receipt) against the chain
CREATE OR REPLACE FUNCTION fn_check_seal(p_seq BIGINT, p_hash_prefix TEXT)
RETURNS TABLE (found BOOLEAN, hash_matches BOOLEAN, row_intact BOOLEAN, chain_intact_to_here BOOLEAN,
               table_name TEXT, operation VARCHAR, occurred_at TIMESTAMP)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH v AS (SELECT * FROM v_audit_chain_verified),
    r AS (SELECT * FROM v WHERE v.seq = p_seq)
    SELECT
        EXISTS (SELECT 1 FROM r),
        coalesce((SELECT r.row_hash LIKE lower(trim(p_hash_prefix)) || '%' AND length(trim(p_hash_prefix)) >= 8 FROM r), false),
        coalesce((SELECT r.seal_ok AND r.link_ok FROM r), false),
        NOT EXISTS (SELECT 1 FROM v WHERE v.seq <= p_seq AND NOT (v.seal_ok AND v.link_ok)),
        (SELECT r.table_name FROM r),
        (SELECT r.operation FROM r),
        (SELECT r.occurred_at FROM r)
$$;

-- Genesis block, then seal every seed row so the chain covers the starting state
SELECT fn_audit_append('audit_chain', 'EVENT', 'genesis', NULL,
    jsonb_build_object('message', 'Audit chain started', 'database', current_database()));

DO $$
DECLARE
    t RECORD;
    r RECORD;
BEGIN
    FOR t IN SELECT * FROM (VALUES
        ('patients', 'patient_id'), ('wards_beds', 'bed_id'), ('admissions', 'admission_id'),
        ('billing', 'bill_id'), ('login_audit', 'audit_id')
    ) AS x(tbl, pk) LOOP
        FOR r IN EXECUTE format('SELECT %I::TEXT AS pk, to_jsonb(t) AS j FROM %I t ORDER BY %I', t.pk, t.tbl, t.pk) LOOP
            PERFORM fn_audit_append(t.tbl, 'INSERT', r.pk, NULL, r.j);
        END LOOP;
    END LOOP;
END $$;

-- Attach the chain to every table that matters
CREATE TRIGGER trg_audit_patients AFTER INSERT OR UPDATE OR DELETE ON patients
FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_chain('patient_id');
CREATE TRIGGER trg_audit_admissions AFTER INSERT OR UPDATE OR DELETE ON admissions
FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_chain('admission_id');
CREATE TRIGGER trg_audit_billing AFTER INSERT OR UPDATE OR DELETE ON billing
FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_chain('bill_id');
CREATE TRIGGER trg_audit_bed_status AFTER UPDATE OF operational_status ON wards_beds
FOR EACH ROW WHEN (OLD.operational_status IS DISTINCT FROM NEW.operational_status)
EXECUTE FUNCTION trg_fn_audit_chain('bed_id');
CREATE TRIGGER trg_audit_prealerts AFTER INSERT OR UPDATE OR DELETE ON ambulance_prealerts
FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_chain('alert_id');
CREATE TRIGGER trg_audit_bed_holds AFTER INSERT OR UPDATE OR DELETE ON bed_holds
FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_chain('hold_id');
CREATE TRIGGER trg_audit_estimates AFTER INSERT OR UPDATE OR DELETE ON cost_estimates
FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_chain('estimate_id');
CREATE TRIGGER trg_audit_login AFTER INSERT ON login_audit
FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_chain('audit_id');

CREATE TRIGGER trg_audit_chain_immutable BEFORE UPDATE OR DELETE ON audit_chain
FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_chain_immutable();
CREATE TRIGGER trg_audit_chain_no_truncate BEFORE TRUNCATE ON audit_chain
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_audit_chain_immutable();

-- Only administrators can read the chain; nobody can write to it directly
GRANT SELECT ON audit_chain, v_audit_chain_verified, audit_tamper_drill TO mr_admin;


-- ============================================================================
-- VERIFICATION CONFIRMATION
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'hospital_db schema initialized: 23 tables, 6 views, 1 materialized view, row-level security, audit chain and seed records. Real-world datasets are loaded next by scripts/init-db.js.';
END $$;
