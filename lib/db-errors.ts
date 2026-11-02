export interface FormattedDbError {
  isConstraintError: boolean;
  constraintName?: string;
  code?: string;
  title: string;
  message: string;
  detail?: string;
}

export function formatPgError(error: any): FormattedDbError {
  if (!error) {
    return {
      isConstraintError: false,
      title: 'Unknown Error',
      message: 'An unexpected database error occurred.',
    };
  }

  const code = error.code;
  const constraint = error.constraint;
  const detail = error.detail || error.message;

  // PostgreSQL 42501: insufficient_privilege (column/table grants and row-level security)
  if (code === '42501') {
    const rls = /row-level security/i.test(error.message || '');
    const table = (error.message || '').match(/(?:table|relation) "?([a-z_]+)"?/i)?.[1];
    return {
      isConstraintError: false,
      code,
      title: rls ? 'Blocked by a row-level security policy' : 'Blocked by PostgreSQL permissions',
      message: rls
        ? `PostgreSQL refused to save this row: a row-level security policy on ${table || 'this table'} does not allow it for your role.`
        : `PostgreSQL refused this request for your role (${error.message}). Access is enforced by the database, not just the screen.`,
      detail,
    };
  }

  // Bed promised to an incoming ambulance (trg_admission_hold_guard)
  if (constraint === 'ex_bed_held_for_ambulance') {
    return {
      isConstraintError: true,
      constraintName: constraint,
      code,
      title: 'Bed Held for an Incoming Ambulance',
      message: `${error.message} Pick another bed, or receive the ambulance from the Golden Hour desk.`,
      detail,
    };
  }

  // Two ambulances promised the same bed (bed_holds exclusion constraint)
  if (constraint === 'ex_no_double_bed_hold' || constraint === 'chk_hold_bed_free') {
    return {
      isConstraintError: true,
      constraintName: constraint,
      code,
      title: 'Bed Hold Conflict',
      message:
        constraint === 'ex_no_double_bed_hold'
          ? 'Another ambulance already holds this bed for an overlapping time window (exclusion constraint ex_no_double_bed_hold).'
          : 'This bed is not free for the whole hold window.',
      detail,
    };
  }

  // PostgreSQL 23P01: exclusion_violation (e.g. ex_no_double_bed_booking)
  if (code === '23P01' || constraint === 'ex_no_double_bed_booking') {
    return {
      isConstraintError: true,
      constraintName: constraint || 'ex_no_double_bed_booking',
      code,
      title: 'Bed Booking Exclusion Conflict (Double Booking Violation)',
      message: 'This bed is already occupied by an active patient or has an overlapping stay duration. The PostgreSQL exclusion constraint [ex_no_double_bed_booking] prevents overlapping admissions on the same physical bed.',
      detail,
    };
  }

  // PostgreSQL 23505: unique_violation
  if (code === '23505') {
    if (constraint === 'patients_national_health_id_key') {
      return {
        isConstraintError: true,
        constraintName: constraint,
        code,
        title: 'Duplicate National Health ID',
        message: 'A patient with this National Health ID is already registered in the system.',
        detail,
      };
    }
    if (constraint === 'billing_admission_id_key') {
      return {
        isConstraintError: true,
        constraintName: constraint,
        code,
        title: 'Bill Already Generated',
        message: 'A billing record already exists for this admission record.',
        detail,
      };
    }
    return {
      isConstraintError: true,
      constraintName: constraint,
      code,
      title: 'Unique Constraint Violation',
      message: 'A record with duplicate unique identifier already exists.',
      detail,
    };
  }

  // PostgreSQL 23514: check_violation
  if (code === '23514') {
    if (constraint === 'chk_triage_esi') {
      return {
        isConstraintError: true,
        constraintName: constraint,
        code,
        title: 'Invalid Triage Priority',
        message: 'Triage priority must be an integer between 1 (Resuscitation) and 5 (Non-urgent).',
        detail,
      };
    }
    if (constraint === 'chk_pat_phone' || constraint === 'chk_doc_phone') {
      return {
        isConstraintError: true,
        constraintName: constraint,
        code,
        title: 'Invalid Phone Number',
        message: 'Phone number must be exactly 10 digits as required by clinical validation rules.',
        detail,
      };
    }
    if (constraint === 'chk_blood_group') {
      return {
        isConstraintError: true,
        constraintName: constraint,
        code,
        title: 'Invalid Blood Group',
        message: 'Blood group must be one of: A+, A-, B+, B-, AB+, AB-, O+, O-.',
        detail,
      };
    }
    if (constraint === 'chk_discount') {
      return {
        isConstraintError: true,
        constraintName: constraint,
        code,
        title: 'Discount Limit Exceeded',
        message: 'Hospital policy check constraint restricts maximum discount to between 0% and 50%.',
        detail,
      };
    }
    if (constraint === 'chk_insurance_limit') {
      return {
        isConstraintError: true,
        constraintName: constraint,
        code,
        title: 'Insurance Claim Limit Exceeded',
        message: 'Approved insurance claim cannot exceed the gross hospital billing amount.',
        detail,
      };
    }
    return {
      isConstraintError: true,
      constraintName: constraint,
      code,
      title: 'Clinical Data Validation Check Failed',
      message: `Database constraint [${constraint || 'check_constraint'}] was violated. Check your inputs.`,
      detail,
    };
  }

  // PostgreSQL 23503: foreign_key_violation
  if (code === '23503') {
    return {
      isConstraintError: true,
      constraintName: constraint,
      code,
      title: 'Referential Integrity Error',
      message: 'Referenced entity (Doctor, Patient, Bed, or Department) does not exist in the database.',
      detail,
    };
  }

  return {
    isConstraintError: false,
    code,
    title: 'Database Operation Failed',
    message: error.message || 'An unexpected database error occurred.',
    detail,
  };
}
