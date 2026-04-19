import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { err, ok, type Result } from 'neverthrow';

export const KOSPI_MST_URL = 'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip';
export const KOSDAQ_MST_URL =
  'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip';

/**
 * KIS 종목 마스터 .mst 파일 고정폭 파싱.
 * - KOSPI 고정부: 227바이트(개행 제외) — kis_kospi_code_mst.py 참조
 * - KOSDAQ 고정부: 221바이트(개행 제외)
 * 가변부 구성: 단축코드(9) + 표준코드(12) + 한글명(가변)
 * 인코딩은 cp949. Korean 글자는 2바이트지만 decoding 후 문자 기준으로 슬라이스.
 */
const KOSPI_FIXED_CHARS = 227;
const KOSDAQ_FIXED_CHARS = 221;

export interface StockMasterEntry {
  pdno: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
  groupCode: string;
}

export interface ParseOptions {
  /** groupCode 필터 (예: ['ST']로 보통주만). 미지정 시 전체. */
  allowGroupCodes?: string[];
}

export function parseKospiMst(text: string, opts: ParseOptions = {}): StockMasterEntry[] {
  return parseMst(text, KOSPI_FIXED_CHARS, 'KOSPI', opts);
}

export function parseKosdaqMst(text: string, opts: ParseOptions = {}): StockMasterEntry[] {
  return parseMst(text, KOSDAQ_FIXED_CHARS, 'KOSDAQ', opts);
}

function parseMst(
  text: string,
  fixedChars: number,
  market: 'KOSPI' | 'KOSDAQ',
  opts: ParseOptions,
): StockMasterEntry[] {
  const out: StockMasterEntry[] = [];
  const allow = opts.allowGroupCodes ? new Set(opts.allowGroupCodes) : null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length <= fixedChars + 21) continue;
    const variable = raw.slice(0, raw.length - fixedChars);
    const fixed = raw.slice(-fixedChars);
    const pdno = variable.slice(0, 9).trimEnd();
    const name = variable.slice(21).trim();
    const groupCode = fixed.slice(0, 2).trim();
    if (!pdno || !name) continue;
    if (allow !== null && !allow.has(groupCode)) continue;
    out.push({ pdno, name, market, groupCode });
  }
  return out;
}

export interface DownloadError {
  kind: 'HTTP' | 'ZIP' | 'NO_MST';
  msg: string;
}

export async function downloadAndParseMaster(
  url: string,
  market: 'KOSPI' | 'KOSDAQ',
  opts: ParseOptions = {},
): Promise<Result<StockMasterEntry[], DownloadError>> {
  let buf: Buffer;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return err({ kind: 'HTTP', msg: `HTTP ${resp.status}` });
    buf = Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    return err({ kind: 'HTTP', msg: e instanceof Error ? e.message : String(e) });
  }

  let zipEntries: AdmZip.IZipEntry[];
  try {
    const zip = new AdmZip(buf);
    zipEntries = zip.getEntries();
  } catch (e) {
    return err({ kind: 'ZIP', msg: e instanceof Error ? e.message : String(e) });
  }

  const mstEntry = zipEntries.find((e) => e.entryName.toLowerCase().endsWith('.mst'));
  if (!mstEntry) return err({ kind: 'NO_MST', msg: 'zip 내부에 .mst 파일이 없습니다' });

  const decoded = iconv.decode(mstEntry.getData(), 'cp949');
  return ok(market === 'KOSPI' ? parseKospiMst(decoded, opts) : parseKosdaqMst(decoded, opts));
}
