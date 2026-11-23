import { Column, Entity, PrimaryColumn } from 'typeorm';
import { TeamRole } from '../../team/entities/merchant-member.entity';
@Entity('merchant_saml_configs')
export class MerchantSamlConfig {
  @PrimaryColumn('uuid') merchantId: string;
  @Column({ unique: true, length: 253 }) domain: string;
  @Column('text') metadataXml: string;
  @Column({ default: false }) requireSso: boolean;
  @Column({ type: 'varchar', length: 20, default: TeamRole.VIEWER }) defaultRole: TeamRole;
}
