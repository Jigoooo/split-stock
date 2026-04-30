import { z } from 'zod';
import type { ToolDef } from '../llm-client';
import type { MarketContextSnapshot } from '../market-context-service';
import { buildRankedMarketContext } from './market-context';
import type { SuggestSymbolsInput } from './types';

export function buildTools(
  input: SuggestSymbolsInput,
  marketContext: MarketContextSnapshot | null,
): ToolDef[] {
  const tools: ToolDef[] = [];
  if (input.searchNewsTool) {
    tools.push(buildSearchNewsTool(input.searchNewsTool) as ToolDef);
  }
  if (input.getDartDisclosuresTool) {
    tools.push(buildDartTool(input.getDartDisclosuresTool) as ToolDef);
  }
  if (marketContext && (marketContext.krxByPdno.size > 0 || marketContext.ecos.length > 0)) {
    tools.push(buildMarketContextTool(marketContext) as ToolDef);
  }
  return tools;
}

function buildSearchNewsTool(searchNews: NonNullable<SuggestSymbolsInput['searchNewsTool']>) {
  const searchNewsParams = z.object({
    query: z.string().min(1).max(60).describe('검색 키워드 — 보통 종목명'),
    max: z.number().int().min(1).max(8).default(5),
  });
  const tool: ToolDef<z.infer<typeof searchNewsParams>> = {
    name: 'search_news',
    description:
      '특정 키워드(종목명, 이슈, 산업 키워드)로 한국 최신 뉴스 검색. 알고리즘 신호가 모호하거나 confidence=low 일 때 호출해 정보 보강.',
    parameters: searchNewsParams,
    run: async (args) => {
      const items = await searchNews(args.query, args.max);
      return JSON.stringify(
        items.map((i) => ({
          date: i.publishedAt,
          title: i.title,
          summary: i.summary.slice(0, 240),
        })),
      );
    },
  };
  return tool;
}

function buildDartTool(getDart: NonNullable<SuggestSymbolsInput['getDartDisclosuresTool']>) {
  const dartParams = z.object({
    corpCode: z.string().min(8).max(8).describe('DART corp_code (8자리)'),
    days: z.number().int().min(1).max(60).default(30),
  });
  const tool: ToolDef<z.infer<typeof dartParams>> = {
    name: 'get_dart_disclosures',
    description:
      'OpenDART 공시 검색 — corpCode + 최근 N일. 자사주매입/실적/유상증자 등 매수 결정에 직접 영향.',
    parameters: dartParams,
    run: async (args) => {
      const items = await getDart(args.corpCode, args.days);
      return JSON.stringify(items);
    },
  };
  return tool;
}

function buildMarketContextTool(marketContext: MarketContextSnapshot) {
  const marketParams = z.object({
    pdno: z
      .string()
      .regex(/^\d{6}$/)
      .describe('후보 풀의 6자리 종목코드'),
  });
  const tool: ToolDef<z.infer<typeof marketParams>> = {
    name: 'get_market_context',
    description:
      'KRX/ECOS 캐시 컨텍스트 조회. 추천 점수 직접 산출이 아닌 보조 사실·리스크 플래그 확인용.',
    parameters: marketParams,
    run: async (args) => JSON.stringify(buildRankedMarketContext(args.pdno, marketContext)),
  };
  return tool;
}
