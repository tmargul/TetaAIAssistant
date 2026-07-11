import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OllamaModule } from '../chat/ollama.module';
import { OracleModule } from '../oracle/oracle.module';
import { SchemaController } from './schema.controller';
import { SchemaCrawlService } from './schema-crawl.service';
import { SchemaExplorerService } from './schema-explorer.service';
import { SchemaGraphService } from './schema-graph.service';
import { OracleAgentService } from './oracle-agent.service';
import { OracleQueryService } from './oracle-query.service';
import { SchemaProcedureService } from './schema-procedure.service';
import { SqlValidatorService } from './sql-validator.service';
import { SchemaLearningModule } from './schema-learning.module';
import { TetaPluginsCoreModule } from '../teta-plugins/teta-plugins-core.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => OracleModule),
    OllamaModule,
    SchemaLearningModule,
    TetaPluginsCoreModule,
  ],
  controllers: [SchemaController],
  providers: [
    SchemaGraphService,
    SchemaCrawlService,
    SchemaExplorerService,
    SqlValidatorService,
    OracleQueryService,
    SchemaProcedureService,
    OracleAgentService,
  ],
  exports: [
    SchemaGraphService,
    SchemaCrawlService,
    SchemaExplorerService,
    OracleAgentService,
    OracleQueryService,
  ],
})
export class SchemaModule {}
