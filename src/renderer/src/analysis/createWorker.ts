import AnalysisWorker from './analysis.worker?worker&inline';

export const createAnalysisWorker = (): Worker => new AnalysisWorker();
