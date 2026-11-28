/**
 * Tree-shaken ECharts registration (F073).
 *
 * Only the pieces the dashboard needs are pulled in: line + bar series, grid,
 * tooltip, the ARIA component and the canvas renderer. Import `echarts` (and
 * `ECOption`) from here — never from the full `echarts` bundle.
 */
import { BarChart, LineChart, type BarSeriesOption, type LineSeriesOption } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
  type AriaComponentOption,
  type GridComponentOption,
  type TooltipComponentOption,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import type { ComposeOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

export type ECOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | AriaComponentOption
>;

export type EChartsInstance = ReturnType<typeof echarts.init>;

export { echarts };
