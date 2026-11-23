import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
@Entity('saml_states')
@Index('IDX_saml_states_expiry', ['expiresAt'])
export class SamlState {
  @PrimaryColumn({ type: 'varchar', length: 128 }) id: string;
  @Column('uuid') merchantId: string;
  @Column('text') value: string;
  @Column('timestamptz') expiresAt: Date;
}
