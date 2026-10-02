import importlib.util, json, tempfile, unittest, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; PATH=ROOT/'scripts'/'build_domestic_origin_context.py'
spec=importlib.util.spec_from_file_location('origins',PATH); M=importlib.util.module_from_spec(spec); spec.loader.exec_module(M)

def cell(ref, value): return f'<c r="{ref}" t="inlineStr"><is><t>{value}</t></is></c>'
def sheet(rows): return '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+''.join('<row r="%s">%s</row>'%(i+1,''.join(cell(chr(65+j)+str(i+1),v) for j,v in enumerate(row))) for i,row in enumerate(rows))+'</sheetData></worksheet>'
def workbook(path, month_rows, names=('Hoja1','2026-01'), note='solo se proporcionan aquellos cruces con más de 30 turistas'):
    sheets=''.join(f'<sheet name="{name}" sheetId="{i+1}" r:id="rId{i+1}"/>' for i,name in enumerate(names)); rels=''.join(f'<Relationship Id="rId{i+1}" Type="x" Target="worksheets/sheet{i+1}.xml"/>' for i in range(len(names)))
    with zipfile.ZipFile(path,'w') as z:
      z.writestr('xl/workbook.xml',f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheets}</sheets></workbook>')
      z.writestr('xl/_rels/workbook.xml.rels',f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>')
      z.writestr('xl/worksheets/sheet1.xml',sheet([['Notas',note]]))
      z.writestr('xl/worksheets/sheet2.xml',sheet(month_rows))

class DomesticOriginBuilder(unittest.TestCase):
  def rows(self, extra=None):
    base=[M.EXPECTED_COLUMNS,['2026-01','01001','Alegría','28079','Madrid','50','01','Álava','28','Madrid'],['2026-01','08019','Barcelona','08019','Barcelona','99','08','Barcelona','08','Barcelona']]
    return base if extra is None else [M.EXPECTED_COLUMNS]+extra
  def build(self, rows=None, names=('Hoja1','2026-01'), note='solo se proporcionan aquellos cruces con más de 30 turistas'):
    temp=tempfile.NamedTemporaryFile(suffix='.xlsx',delete=False); temp.close(); workbook(temp.name,rows or self.rows(),names,note); self.addCleanup(Path(temp.name).unlink); return temp.name
  def test_month_discovery_exact_schema_madrid_filter_and_zero_padding(self):
    path=self.build(); self.assertEqual([n for n,_ in M.discover_month_sheets(path)],['2026-01']); records=M.build_records(path); self.assertEqual(records[0]['published_origins'][0]['origin_municipality_code'],'01001')
  def test_schema_drift_and_missing_suppression_statement_fail_closed(self):
    rows=self.rows(); rows[0]=list(rows[0]); rows[0][-1]='province';
    with self.assertRaises(M.BuildError): M.build_records(self.build(rows))
    with self.assertRaises(M.BuildError): M.verify_suppression_statement(self.build(note='no suppression note'))
  def test_destination_mismatch_duplicate_and_bad_counts_fail_closed(self):
    for rows in [
      self.rows([['2026-01','01001','A','28079','Madrid','40','01','X','28','Other']]),
      self.rows([['2026-01','01001','A','28079','Madrid','40','01','X','28','Madrid'],['2026-01','01001','A','28079','Madrid','41','01','X','28','Madrid']]),
      self.rows([['2026-01','01001','A','28079','Madrid','40.5','01','X','28','Madrid']]),
      self.rows([['2026-01','01001','A','28079','Madrid','-1','01','X','28','Madrid']]),
      self.rows([['2026-01','01001','A','28079','Madrid','NaN','01','X','28','Madrid']]),
      self.rows([['2026-01','01001','A','28079','Madrid','Infinity','01','X','28','Madrid']]),
      self.rows([['2026-01','01001','A','2807','Madrid','40','01','X','28','Madrid']]),
      self.rows([['2026-01','1001','A','28079','Madrid','40','01','X','28','Madrid']]),
    ]:
      with self.assertRaises(M.BuildError): M.build_records(self.build(rows))
  def test_deterministic_order_fingerprint_latest_and_no_submunicipal_fields(self):
    rows=self.rows([['2026-01','02001','Zulu','28079','Madrid','40','02','B','28','Madrid'],['2026-01','01001','Alpha','28079','Madrid','50','01','A','28','Madrid']]); months=M.build_records(self.build(rows)); self.assertEqual([x['origin_municipality_name'] for x in months[0]['published_origins']],['Alpha','Zulu']); self.assertEqual(M.schema_fingerprint(),M.schema_fingerprint()); artifact,meta=M.artifacts(months,2026,'url','2026-10-02T00:00:00Z'); self.assertEqual(artifact['source_period']['latest'],'2026-01'); self.assertEqual(artifact['schema_fingerprint'],meta['schema_fingerprint']); self.assertEqual(artifact['source'],meta['source']); self.assertEqual(artifact['source']['workbook_year'],2026); self.assertFalse({'barrio','district','lat','lon','geometry'} & set(artifact['months'][0]['published_origins'][0]))

if __name__=='__main__': unittest.main()
