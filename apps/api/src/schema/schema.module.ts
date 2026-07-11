import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OllamaModule } from '../chat/ollama.module';
import { OracleModule } from '../oracle/oracle.module';
import { SchemaController } from './schema.controller';
import { SchemaCrawlService } from './schema-crawl.service';
import { SchemaExplorerService } from './schema-explorer.service';
import { SchemaGraphCoreModule } from './schema-graph-core.module';
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
    SchemaGraphCoreModule,
    TetaPluginsCoreModule,
  ],
  controllers: [SchemaController],
  providers: [
    SchemaCrawlService,
    SchemaExplorerService,
    SqlValidatorService,
    OracleQueryService,
    SchemaProcedureService,
    OracleAgentService,
  ],
  exports: [
    SchemaGraphCoreModule,
    SchemaCrawlService,
    SchemaExplorerService,
    OracleAgentService,
    OracleQueryService,
  ],
})
export class SchemaModule {}
