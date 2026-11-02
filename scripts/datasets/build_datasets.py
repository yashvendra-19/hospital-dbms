"""
Builds the real-world dataset extracts that ship in database/datasets/.

You only need this script to rebuild the extracts from the raw public files.
`npm run db:setup` loads the finished extracts; it does not run this script.

Raw inputs (all public):
  1. National Hospital Directory, National Health Portal (Govt. of India), published on data.gov.in.
     GitHub mirror used: https://raw.githubusercontent.com/saiuday07/hospital-accessibility/HEAD/data/raw/hospital_directory.csv
  2. All-India pincode list with latitude/longitude (India Post pincodes, geocoded).
     https://raw.githubusercontent.com/mrparveensharma/All-India-Pincode-list-with-latitude-and-longitude/HEAD/All-India-Pincode-list-with-latitude-and-longitude.csv
  3. Hospital Inpatient Discharges (SPARCS De-Identified) 2021, New York State Department of Health
     (health.data.ny.gov, also on Kaggle). Cleaned parquet of all 2,098,967 discharges:
     https://raw.githubusercontent.com/Shivamm638/IDAI107-2505469---Shivam_Bhuva/HEAD/data/processed/discharges_2021_clean.parquet

Usage:
  python scripts/datasets/build_datasets.py --nhp hospital_directory.csv --pincodes pincodes.csv \
      --sparcs discharges_2021_clean.parquet --out database/datasets
Requires: pandas, pyarrow
"""

import argparse
import csv
import gzip
import hashlib
import json
import re
from pathlib import Path

# Conditions offered by the cost estimator. condition_id must match the
# condition_catalog seed in database/setup_hospital_db.sql.
# (condition_id, CCSR code, age scope, dept_id)
CATALOG = [
    (1, 'INF002', 'adult', 1), (2, 'INJ008', 'adult', 1), (3, 'INJ010', 'adult', 1), (4, 'INJ006', 'adult', 1),
    (5, 'INJ005', 'adult', 1), (6, 'INJ003', 'adult', 1), (7, 'INJ022', 'adult', 1), (8, 'INJ019', 'adult', 1),
    (9, 'RSP012', 'adult', 1), (10, 'RSP002', 'adult', 1), (11, 'DIG009', 'adult', 1), (12, 'DIG021', 'adult', 1),
    (13, 'INF012', 'adult', 1),
    (14, 'CIR009', 'adult', 2), (15, 'CIR019', 'adult', 2), (16, 'CIR017', 'adult', 2), (17, 'CIR011', 'adult', 2),
    (18, 'CIR012', 'adult', 2), (19, 'CIR013', 'adult', 2),
    (20, 'CIR020', 'adult', 3), (21, 'CIR021', 'adult', 3), (22, 'NVS009', 'adult', 3), (23, 'NVS012', 'adult', 3),
    (24, 'INJ009', 'adult', 3),
    (25, 'RSP009', 'child', 4), (26, 'RSP005', 'child', 4), (27, 'RSP002', 'child', 4), (28, 'NVS009', 'child', 4),
    (29, 'DIG001', 'child', 4), (30, 'PNL007', 'child', 4), (31, 'PNL006', 'child', 4), (32, 'INF002', 'child', 4),
]
SAMPLE_PER_CONDITION = 1500
SEED = 2021
INDIA_BOX = (6.0, 37.6, 68.0, 97.5)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def clean(v: str):
    v = (v or '').strip()
    return None if v in ('', '0', 'NA', 'N/A', '-') else v


def in_india(lat, lon):
    return INDIA_BOX[0] < lat < INDIA_BOX[1] and INDIA_BOX[2] < lon < INDIA_BOX[3]


def build_nhp(nhp_path: Path, pin_path: Path, out: Path):
    pins = {}
    with open(pin_path, encoding='utf-8', errors='replace') as f:
        for r in csv.DictReader(f):
            try:
                lat, lon = float(r['Latitude']), float(r['Longitude'])
            except ValueError:
                continue
            if in_india(lat, lon):
                pins.setdefault(r['Pincode'].strip(), []).append((lat, lon))
    centroid = {p: (sum(a for a, _ in v) / len(v), sum(b for _, b in v) / len(v)) for p, v in pins.items()}

    cols = ['nhp_sr_no', 'hospital_name', 'hospital_category', 'care_type', 'discipline', 'address', 'state',
            'district', 'pincode', 'telephone', 'mobile', 'emergency_phone', 'ambulance_phone', 'bloodbank_phone',
            'specialties', 'facilities', 'total_beds', 'emergency_services', 'latitude', 'longitude', 'geo_source']
    stats = {'rows': 0, 'directory': 0, 'pincode': 0, 'none': 0}
    with open(nhp_path, encoding='utf-8', errors='replace') as f, gzip.open(out, 'wt', newline='', encoding='utf-8') as g:
        w = csv.writer(g)
        w.writerow(cols)
        for r in csv.DictReader(f):
            lat = lon = None
            src = None
            m = re.match(r'\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)', r['Location_Coordinates'] or '')
            if m and in_india(float(m[1]), float(m[2])):
                lat, lon, src = float(m[1]), float(m[2]), 'directory'
            elif (r['Pincode'] or '').strip() in centroid:
                lat, lon = centroid[r['Pincode'].strip()]
                src = 'pincode'
            stats[src or 'none'] += 1
            stats['rows'] += 1
            pin = clean(r['Pincode'])
            beds = clean(r['Total_Num_Beds'])
            w.writerow([
                int(r['Sr_No']), (r['Hospital_Name'] or '').strip()[:200], clean(r['Hospital_Category']),
                clean(r['Hospital_Care_Type']), clean(r['Discipline_Systems_of_Medicine']),
                (clean(r['Address_Original_First_Line']) or '')[:300] or None, (r['State'] or '').strip(),
                clean(r['District']), pin if pin and re.fullmatch(r'\d{6}', pin) else None,
                (clean(r['Telephone']) or '')[:60] or None, (clean(r['Mobile_Number']) or '')[:60] or None,
                (clean(r['Emergency_Num']) or '')[:60] or None, (clean(r['Ambulance_Phone_No']) or '')[:60] or None,
                (clean(r['Bloodbank_Phone_No']) or '')[:60] or None, (clean(r['Specialties']) or '')[:600] or None,
                (clean(r['Facilities']) or '')[:600] or None, int(beds) if beds and beds.isdigit() and int(beds) <= 5000 else None,  # some rows hold phone numbers here
                clean(r['Emergency_Services']), None if lat is None else round(lat, 6),
                None if lon is None else round(lon, 6), src,
            ])
    return stats


def build_pincodes(pin_path: Path, out: Path):
    """One row per pincode: centroid of its post offices, plus district/state and a sample locality."""
    acc = {}
    with open(pin_path, encoding='utf-8', errors='replace') as f:
        for r in csv.DictReader(f):
            pin = (r['Pincode'] or '').strip()
            try:
                lat, lon = float(r['Latitude']), float(r['Longitude'])
            except ValueError:
                continue
            if not re.fullmatch(r'\d{6}', pin) or not in_india(lat, lon):
                continue
            a = acc.setdefault(pin, {'lat': 0.0, 'lon': 0.0, 'n': 0, 'district': r['District'].strip(),
                                     'state': r['State'].strip().title(), 'locality': r['CityName/AreaName'].strip()})
            a['lat'] += lat
            a['lon'] += lon
            a['n'] += 1
    with gzip.open(out, 'wt', newline='', encoding='utf-8') as g:
        w = csv.writer(g)
        w.writerow(['pincode', 'locality', 'district', 'state', 'latitude', 'longitude', 'post_offices'])
        for pin in sorted(acc):
            a = acc[pin]
            w.writerow([pin, a['locality'][:80], a['district'][:60], a['state'][:60],
                        round(a['lat'] / a['n'], 6), round(a['lon'] / a['n'], 6), a['n']])
    return len(acc)


def build_sparcs(parquet: Path, out: Path):
    import pandas as pd

    df = pd.read_parquet(parquet)
    total = len(df)
    child = df['age_group'].astype(str).eq('0 to 17')
    parts = []
    for cid, code, scope, _ in CATALOG:
        mask = df['dx_code'].astype(str).eq(code) & (child if scope == 'child' else ~child)
        sub = df[mask]
        n = min(SAMPLE_PER_CONDITION, len(sub))
        s = sub.sample(n=n, random_state=SEED + cid).copy()
        s['condition_id'] = cid
        s['population'] = len(sub)
        parts.append(s)
    sample = pd.concat(parts, ignore_index=True)

    gender = sample['gender'].astype(str).map({'Male': 'M', 'Female': 'F'}).fillna('U')
    outdf = pd.DataFrame({
        'condition_id': sample['condition_id'],
        'ccsr_dx_code': sample['dx_code'].astype(str),
        'facility_name': sample['facility_name'].astype(str).str.slice(0, 120),
        'region': sample['region'].astype(str),
        'age_group': sample['age_group'].astype(str),
        'gender': gender,
        'admission_type': sample['admission_type'].astype(str),
        'ed_admission': sample['ed_admission'].map({True: 't', False: 'f'}),
        'severity_code': sample['severity_code'].astype(int),
        'mortality_risk': sample['mortality_risk'].astype(str),
        'medical_surgical': sample['medical_surgical'].astype(str),
        'length_of_stay': sample['length_of_stay'].astype(int),
        'disposition_group': sample['disposition_group'].astype(str),
        'died_in_hospital': sample['died_in_hospital'].map({True: 't', False: 'f'}),
        'payment_type': sample['payment_type'].astype(str),
        'total_charges_usd': sample['total_charges'].round(2),
        'total_costs_usd': sample['total_costs'].round(2),
    })
    with gzip.open(out, 'wt', newline='', encoding='utf-8') as g:
        outdf.to_csv(g, index=False)
    pops = {int(cid): int(p) for cid, p in sample.groupby('condition_id')['population'].first().items()}
    return {'rows_in_source': total, 'rows': len(outdf), 'population_by_condition': pops}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--nhp', required=True, type=Path)
    ap.add_argument('--pincodes', required=True, type=Path)
    ap.add_argument('--sparcs', required=True, type=Path)
    ap.add_argument('--out', default=Path('database/datasets'), type=Path)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    nhp_stats = build_nhp(a.nhp, a.pincodes, a.out / 'nhp_hospital_directory.csv.gz')
    pin_rows = build_pincodes(a.pincodes, a.out / 'india_pincodes.csv.gz')
    sparcs_stats = build_sparcs(a.sparcs, a.out / 'sparcs_2021_sample.csv.gz')
    manifest = {
        'nhp_hospital_directory': {
            'title': 'National Hospital Directory (National Health Portal, Govt. of India)',
            'publisher': 'Ministry of Health & Family Welfare via data.gov.in',
            'url': 'https://data.gov.in/catalog/hospital-directory-national-health-portal',
            'mirror_url': 'https://github.com/saiuday07/hospital-accessibility/blob/main/data/raw/hospital_directory.csv',
            'licence': 'Government Open Data Licence - India (GODL)',
            'raw_sha256': sha256(a.nhp),
            'rows_in_source': nhp_stats['rows'],
            'rows_loaded': nhp_stats['rows'],
            'notes': f"Coordinates: {nhp_stats['directory']} from the directory, {nhp_stats['pincode']} from the pincode "
                     f"centroid (approximate), {nhp_stats['none']} not located.",
        },
        'india_pincode_geo': {
            'title': 'All India pincode list with latitude and longitude',
            'publisher': 'India Post pincode directory, geocoded (community mirror)',
            'url': 'https://github.com/mrparveensharma/All-India-Pincode-list-with-latitude-and-longitude',
            'licence': 'Public data (India Post / data.gov.in)',
            'raw_sha256': sha256(a.pincodes),
            'rows_in_source': pin_rows,
            'rows_loaded': pin_rows,
            'notes': 'One centroid per pincode. Places directory hospitals that have no coordinates and lets '
                     'ambulance crews report their location by pincode.',
        },
        'sparcs_2021': {
            'title': 'Hospital Inpatient Discharges (SPARCS De-Identified): 2021',
            'publisher': 'New York State Department of Health',
            'url': 'https://health.data.ny.gov/Health/Hospital-Inpatient-Discharges-SPARCS-De-Identified/tg3i-cinn',
            'mirror_url': 'https://github.com/Shivamm638/IDAI107-2505469---Shivam_Bhuva/blob/main/data/processed/discharges_2021_clean.parquet',
            'licence': 'NYS Open Data terms of use',
            'raw_sha256': sha256(a.sparcs),
            'rows_in_source': sparcs_stats['rows_in_source'],
            'rows_loaded': sparcs_stats['rows'],
            'notes': f'Random sample of up to {SAMPLE_PER_CONDITION} real discharges per catalogued condition '
                     f'(seed {SEED}). Population per condition is kept in condition_catalog.source_population.',
            'population_by_condition': sparcs_stats['population_by_condition'],
        },
    }
    (a.out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != 'population_by_condition'} for k, v in manifest.items()}, indent=2))
    print('population_by_condition', sparcs_stats['population_by_condition'])


if __name__ == '__main__':
    main()
