export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_agent_config: {
        Row: {
          agenda_antecedencia_horas: number | null
          agenda_horizonte_dias: number | null
          agent_name: string
          clinic_id: string
          closing: string | null
          conhecimento: Json
          created_at: string
          escalation_rules: Json
          exige_cpf: boolean
          exige_nascimento: boolean
          exige_nome_completo: boolean
          fallback_minutes: number | null
          greeting: string | null
          id: string
          instrucoes: string | null
          operating_hours: Json | null
          operating_mode: string
          publico_atendido: string | null
          published_at: string | null
          published_by: string | null
          skills: Json
          status: string
          tone: string
          updated_at: string
          use_emoji: boolean
          version: number
        }
        Insert: {
          agenda_antecedencia_horas?: number | null
          agenda_horizonte_dias?: number | null
          agent_name?: string
          clinic_id: string
          closing?: string | null
          conhecimento?: Json
          created_at?: string
          escalation_rules?: Json
          exige_cpf?: boolean
          exige_nascimento?: boolean
          exige_nome_completo?: boolean
          fallback_minutes?: number | null
          greeting?: string | null
          id?: string
          instrucoes?: string | null
          operating_hours?: Json | null
          operating_mode?: string
          publico_atendido?: string | null
          published_at?: string | null
          published_by?: string | null
          skills?: Json
          status?: string
          tone?: string
          updated_at?: string
          use_emoji?: boolean
          version?: number
        }
        Update: {
          agenda_antecedencia_horas?: number | null
          agenda_horizonte_dias?: number | null
          agent_name?: string
          clinic_id?: string
          closing?: string | null
          conhecimento?: Json
          created_at?: string
          escalation_rules?: Json
          exige_cpf?: boolean
          exige_nascimento?: boolean
          exige_nome_completo?: boolean
          fallback_minutes?: number | null
          greeting?: string | null
          id?: string
          instrucoes?: string | null
          operating_hours?: Json | null
          operating_mode?: string
          publico_atendido?: string | null
          published_at?: string | null
          published_by?: string | null
          skills?: Json
          status?: string
          tone?: string
          updated_at?: string
          use_emoji?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_config_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_decision_log: {
        Row: {
          agente_modelo: string | null
          aprovado: boolean | null
          blocked_draft: string | null
          camada: string | null
          clinic_id: string
          compliance_blocked: boolean
          compliance_rule: string | null
          config_version: number | null
          context_read: Json | null
          conversation_id: string
          created_at: string
          desfecho: string | null
          escalation_reason: string | null
          gatilho_entrada: string | null
          id: string
          job_id: string | null
          latency_ms: number | null
          message_id: string | null
          motivo_da_falha: string | null
          texto_sha256: string | null
          tokens_cache: number | null
          tokens_entrada: number | null
          tokens_saida: number | null
          tool_used: string | null
          verificador_modelo: string | null
          versao_filtro: string | null
          versao_prompt: string | null
        }
        Insert: {
          agente_modelo?: string | null
          aprovado?: boolean | null
          blocked_draft?: string | null
          camada?: string | null
          clinic_id: string
          compliance_blocked?: boolean
          compliance_rule?: string | null
          config_version?: number | null
          context_read?: Json | null
          conversation_id: string
          created_at?: string
          desfecho?: string | null
          escalation_reason?: string | null
          gatilho_entrada?: string | null
          id?: string
          job_id?: string | null
          latency_ms?: number | null
          message_id?: string | null
          motivo_da_falha?: string | null
          texto_sha256?: string | null
          tokens_cache?: number | null
          tokens_entrada?: number | null
          tokens_saida?: number | null
          tool_used?: string | null
          verificador_modelo?: string | null
          versao_filtro?: string | null
          versao_prompt?: string | null
        }
        Update: {
          agente_modelo?: string | null
          aprovado?: boolean | null
          blocked_draft?: string | null
          camada?: string | null
          clinic_id?: string
          compliance_blocked?: boolean
          compliance_rule?: string | null
          config_version?: number | null
          context_read?: Json | null
          conversation_id?: string
          created_at?: string
          desfecho?: string | null
          escalation_reason?: string | null
          gatilho_entrada?: string | null
          id?: string
          job_id?: string | null
          latency_ms?: number | null
          message_id?: string | null
          motivo_da_falha?: string | null
          texto_sha256?: string | null
          tokens_cache?: number | null
          tokens_entrada?: number | null
          tokens_saida?: number | null
          tool_used?: string | null
          verificador_modelo?: string | null
          versao_filtro?: string | null
          versao_prompt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_decision_log_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decision_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decision_log_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_rascunho_bloqueado: {
        Row: {
          clinic_id: string
          conversation_id: string
          created_at: string
          decision_id: string
          id: string
          job_id: string
          texto: string
        }
        Insert: {
          clinic_id: string
          conversation_id: string
          created_at?: string
          decision_id: string
          id?: string
          job_id: string
          texto: string
        }
        Update: {
          clinic_id?: string
          conversation_id?: string
          created_at?: string
          decision_id?: string
          id?: string
          job_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_rascunho_bloqueado_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rascunho_bloqueado_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "ai_decision_log"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_turno: {
        Row: {
          clinic_id: string
          conversation_id: string
          created_at: string
          decision_id: string | null
          estado: string
          job_id: string
          mensagens_lidas: string[]
          reserva_id: string | null
          reservas_perdidas: string[]
          saida: string | null
          texto: string | null
          texto_sha256: string | null
          updated_at: string
        }
        Insert: {
          clinic_id: string
          conversation_id: string
          created_at?: string
          decision_id?: string | null
          estado: string
          job_id: string
          mensagens_lidas?: string[]
          reserva_id?: string | null
          reservas_perdidas?: string[]
          saida?: string | null
          texto?: string | null
          texto_sha256?: string | null
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          conversation_id?: string
          created_at?: string
          decision_id?: string | null
          estado?: string
          job_id?: string
          mensagens_lidas?: string[]
          reserva_id?: string | null
          reservas_perdidas?: string[]
          saida?: string | null
          texto?: string | null
          texto_sha256?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_turno_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      anuncio_do_whatsapp: {
        Row: {
          ad_id: string
          atualizado_em: string
          clinic_id: string
          descricao: string | null
          link: string | null
          plataforma: string | null
          primeiro_visto_em: string
          texto_visto_em: string
          tipo: string | null
          titulo: string | null
        }
        Insert: {
          ad_id: string
          atualizado_em?: string
          clinic_id: string
          descricao?: string | null
          link?: string | null
          plataforma?: string | null
          primeiro_visto_em?: string
          texto_visto_em?: string
          tipo?: string | null
          titulo?: string | null
        }
        Update: {
          ad_id?: string
          atualizado_em?: string
          clinic_id?: string
          descricao?: string | null
          link?: string | null
          plataforma?: string | null
          primeiro_visto_em?: string
          texto_visto_em?: string
          tipo?: string | null
          titulo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "anuncio_do_whatsapp_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment: {
        Row: {
          approval_status: string | null
          clinic_id: string
          confirmation_channel: string | null
          confirmed_by_user_id: string | null
          contact_id: string
          created_at: string
          created_by: string
          ends_at: string
          external_id: string | null
          id: string
          is_overbooking: boolean
          notes: string | null
          oferecer_vaga_ao_cancelar: boolean
          package_balance_id: string | null
          package_balance_item_id: string | null
          professional_id: string
          remarcacao_pedida_em: string | null
          resource_id: string | null
          send_confirmation: boolean
          service_link_id: string
          source: string
          starts_at: string
          status: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: string | null
          clinic_id: string
          confirmation_channel?: string | null
          confirmed_by_user_id?: string | null
          contact_id: string
          created_at?: string
          created_by?: string
          ends_at: string
          external_id?: string | null
          id?: string
          is_overbooking?: boolean
          notes?: string | null
          oferecer_vaga_ao_cancelar?: boolean
          package_balance_id?: string | null
          package_balance_item_id?: string | null
          professional_id: string
          remarcacao_pedida_em?: string | null
          resource_id?: string | null
          send_confirmation?: boolean
          service_link_id: string
          source?: string
          starts_at: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: string | null
          clinic_id?: string
          confirmation_channel?: string | null
          confirmed_by_user_id?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string
          ends_at?: string
          external_id?: string | null
          id?: string
          is_overbooking?: boolean
          notes?: string | null
          oferecer_vaga_ao_cancelar?: boolean
          package_balance_id?: string | null
          package_balance_item_id?: string | null
          professional_id?: string
          remarcacao_pedida_em?: string | null
          resource_id?: string | null
          send_confirmation?: boolean
          service_link_id?: string
          source?: string
          starts_at?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_package_balance_id_fkey"
            columns: ["package_balance_id"]
            isOneToOne: false
            referencedRelation: "package_balance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_package_balance_item_id_fkey"
            columns: ["package_balance_item_id"]
            isOneToOne: false
            referencedRelation: "package_balance_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resource"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_service_link_id_fkey"
            columns: ["service_link_id"]
            isOneToOne: false
            referencedRelation: "service_link"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "unit"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_status_history: {
        Row: {
          appointment_id: string
          changed_at: string
          changed_by: string
          changed_by_user_id: string | null
          clinic_id: string
          event: string | null
          id: string
          kind: string
          new_professional_id: string | null
          new_starts_at: string | null
          previous_professional_id: string | null
          previous_starts_at: string | null
          status: string
        }
        Insert: {
          appointment_id: string
          changed_at?: string
          changed_by?: string
          changed_by_user_id?: string | null
          clinic_id: string
          event?: string | null
          id?: string
          kind?: string
          new_professional_id?: string | null
          new_starts_at?: string | null
          previous_professional_id?: string | null
          previous_starts_at?: string | null
          status: string
        }
        Update: {
          appointment_id?: string
          changed_at?: string
          changed_by?: string
          changed_by_user_id?: string | null
          clinic_id?: string
          event?: string | null
          id?: string
          kind?: string
          new_professional_id?: string | null
          new_starts_at?: string | null
          previous_professional_id?: string | null
          previous_starts_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_status_history_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_status_history_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_status_history_new_professional_id_fkey"
            columns: ["new_professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_status_history_previous_professional_id_fkey"
            columns: ["previous_professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          clinic_id: string | null
          created_at: string
          detalhes: Json | null
          entity: string
          entity_id: string | null
          id: number
          ip: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          clinic_id?: string | null
          created_at?: string
          detalhes?: Json | null
          entity: string
          entity_id?: string | null
          id?: number
          ip?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          clinic_id?: string | null
          created_at?: string
          detalhes?: Json | null
          entity?: string
          entity_id?: string | null
          id?: number
          ip?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      automacao_acao: {
        Row: {
          acao: string
          atividade_prazo_dias: number | null
          atividade_titulo: string | null
          automacao_id: string
          clinic_id: string
          created_at: string
          etapa_destino: string | null
          etiqueta: string | null
          id: string
          motivo_perda: string | null
          nota_texto: string | null
          posicao: number
        }
        Insert: {
          acao: string
          atividade_prazo_dias?: number | null
          atividade_titulo?: string | null
          automacao_id: string
          clinic_id: string
          created_at?: string
          etapa_destino?: string | null
          etiqueta?: string | null
          id?: string
          motivo_perda?: string | null
          nota_texto?: string | null
          posicao: number
        }
        Update: {
          acao?: string
          atividade_prazo_dias?: number | null
          atividade_titulo?: string | null
          automacao_id?: string
          clinic_id?: string
          created_at?: string
          etapa_destino?: string | null
          etiqueta?: string | null
          id?: string
          motivo_perda?: string | null
          nota_texto?: string | null
          posicao?: number
        }
        Relationships: [
          {
            foreignKeyName: "automacao_acao_automacao_fkey"
            columns: ["automacao_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "automacao_fluxo"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "automacao_acao_etapa_destino_fkey"
            columns: ["clinic_id", "etapa_destino"]
            isOneToOne: false
            referencedRelation: "funnel_stage_def"
            referencedColumns: ["clinic_id", "chave"]
          },
          {
            foreignKeyName: "automacao_acao_etiqueta_fkey"
            columns: ["clinic_id", "etiqueta"]
            isOneToOne: false
            referencedRelation: "conversation_tag_def"
            referencedColumns: ["clinic_id", "chave"]
          },
        ]
      }
      automacao_condicao: {
        Row: {
          automacao_id: string
          clinic_id: string
          created_at: string
          etiqueta: string
          id: string
          posicao: number
          tipo: string
        }
        Insert: {
          automacao_id: string
          clinic_id: string
          created_at?: string
          etiqueta: string
          id?: string
          posicao: number
          tipo: string
        }
        Update: {
          automacao_id?: string
          clinic_id?: string
          created_at?: string
          etiqueta?: string
          id?: string
          posicao?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "automacao_condicao_automacao_fkey"
            columns: ["automacao_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "automacao_fluxo"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      automacao_execucao: {
        Row: {
          acao: string | null
          atividade_id: string | null
          automacao_id: string
          clinic_id: string
          contact_id: string
          conversation_id: string | null
          created_at: string
          de_etapa: string
          devida_em: string
          entrada_na_etapa: string
          etiqueta: string | null
          etiqueta_nome: string | null
          executada_em: string | null
          id: string
          message_id: string | null
          motivo: string | null
          para_etapa: string | null
          profundidade: number
          status: string
          updated_at: string
        }
        Insert: {
          acao?: string | null
          atividade_id?: string | null
          automacao_id: string
          clinic_id: string
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          de_etapa: string
          devida_em: string
          entrada_na_etapa: string
          etiqueta?: string | null
          etiqueta_nome?: string | null
          executada_em?: string | null
          id?: string
          message_id?: string | null
          motivo?: string | null
          para_etapa?: string | null
          profundidade?: number
          status?: string
          updated_at?: string
        }
        Update: {
          acao?: string | null
          atividade_id?: string | null
          automacao_id?: string
          clinic_id?: string
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          de_etapa?: string
          devida_em?: string
          entrada_na_etapa?: string
          etiqueta?: string | null
          etiqueta_nome?: string | null
          executada_em?: string | null
          id?: string
          message_id?: string | null
          motivo?: string | null
          para_etapa?: string | null
          profundidade?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automacao_execucao_atividade_id_fkey"
            columns: ["atividade_id"]
            isOneToOne: false
            referencedRelation: "contact_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacao_execucao_automacao_id_fkey"
            columns: ["automacao_id"]
            isOneToOne: false
            referencedRelation: "automacao_fluxo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacao_execucao_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacao_execucao_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacao_execucao_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacao_execucao_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
        ]
      }
      automacao_execucao_acao: {
        Row: {
          acao: string
          atividade_id: string | null
          clinic_id: string
          conversation_id: string | null
          etiqueta: string | null
          etiqueta_nome: string | null
          execucao_id: string
          executada_em: string
          id: string
          message_id: string | null
          motivo: string | null
          para_etapa: string | null
          posicao: number
          status: string
        }
        Insert: {
          acao: string
          atividade_id?: string | null
          clinic_id: string
          conversation_id?: string | null
          etiqueta?: string | null
          etiqueta_nome?: string | null
          execucao_id: string
          executada_em?: string
          id?: string
          message_id?: string | null
          motivo?: string | null
          para_etapa?: string | null
          posicao: number
          status: string
        }
        Update: {
          acao?: string
          atividade_id?: string | null
          clinic_id?: string
          conversation_id?: string | null
          etiqueta?: string | null
          etiqueta_nome?: string | null
          execucao_id?: string
          executada_em?: string
          id?: string
          message_id?: string | null
          motivo?: string | null
          para_etapa?: string | null
          posicao?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automacao_execucao_acao_atividade_id_fkey"
            columns: ["atividade_id"]
            isOneToOne: false
            referencedRelation: "contact_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacao_execucao_acao_execucao_id_fkey"
            columns: ["execucao_id"]
            isOneToOne: false
            referencedRelation: "automacao_execucao"
            referencedColumns: ["id"]
          },
        ]
      }
      automacao_fluxo: {
        Row: {
          acao: string | null
          ativa: boolean
          atividade_prazo_dias: number | null
          atividade_titulo: string | null
          clinic_id: string
          combinar: string
          created_at: string
          created_by: string | null
          espera_minutos: number | null
          etapa: string
          etapa_destino: string | null
          etiqueta: string | null
          gatilho: string
          id: string
          motivo_perda: string | null
          nome: string
          nota_texto: string | null
          updated_at: string
          updated_by: string | null
          vigente_desde: string
        }
        Insert: {
          acao?: string | null
          ativa?: boolean
          atividade_prazo_dias?: number | null
          atividade_titulo?: string | null
          clinic_id: string
          combinar?: string
          created_at?: string
          created_by?: string | null
          espera_minutos?: number | null
          etapa: string
          etapa_destino?: string | null
          etiqueta?: string | null
          gatilho: string
          id?: string
          motivo_perda?: string | null
          nome: string
          nota_texto?: string | null
          updated_at?: string
          updated_by?: string | null
          vigente_desde?: string
        }
        Update: {
          acao?: string | null
          ativa?: boolean
          atividade_prazo_dias?: number | null
          atividade_titulo?: string | null
          clinic_id?: string
          combinar?: string
          created_at?: string
          created_by?: string | null
          espera_minutos?: number | null
          etapa?: string
          etapa_destino?: string | null
          etiqueta?: string | null
          gatilho?: string
          id?: string
          motivo_perda?: string | null
          nome?: string
          nota_texto?: string | null
          updated_at?: string
          updated_by?: string | null
          vigente_desde?: string
        }
        Relationships: [
          {
            foreignKeyName: "automacao_fluxo_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacao_fluxo_etapa_destino_fkey"
            columns: ["clinic_id", "etapa_destino"]
            isOneToOne: false
            referencedRelation: "funnel_stage_def"
            referencedColumns: ["clinic_id", "chave"]
          },
          {
            foreignKeyName: "automacao_fluxo_etapa_fkey"
            columns: ["clinic_id", "etapa"]
            isOneToOne: false
            referencedRelation: "funnel_stage_def"
            referencedColumns: ["clinic_id", "chave"]
          },
          {
            foreignKeyName: "automacao_fluxo_etiqueta_fkey"
            columns: ["clinic_id", "etiqueta"]
            isOneToOne: false
            referencedRelation: "conversation_tag_def"
            referencedColumns: ["clinic_id", "chave"]
          },
        ]
      }
      cadence: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          etiquetas: string[]
          etiquetas_modo: string
          for_no_show_history: boolean
          id: string
          kind: string
          name: string
          no_show_threshold: number
          prioridade: number
          procedure_id: string | null
          professional_id: string | null
          send_weekdays: number[] | null
          send_window_end: string | null
          send_window_start: string | null
          specialty: string | null
          trigger_stage: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          etiquetas?: string[]
          etiquetas_modo?: string
          for_no_show_history?: boolean
          id?: string
          kind: string
          name: string
          no_show_threshold?: number
          prioridade?: number
          procedure_id?: string | null
          professional_id?: string | null
          send_weekdays?: number[] | null
          send_window_end?: string | null
          send_window_start?: string | null
          specialty?: string | null
          trigger_stage?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          etiquetas?: string[]
          etiquetas_modo?: string
          for_no_show_history?: boolean
          id?: string
          kind?: string
          name?: string
          no_show_threshold?: number
          prioridade?: number
          procedure_id?: string | null
          professional_id?: string | null
          send_weekdays?: number[] | null
          send_window_end?: string | null
          send_window_start?: string | null
          specialty?: string | null
          trigger_stage?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_run: {
        Row: {
          appointment_id: string | null
          cadence_step_id: string
          clinic_id: string
          contact_id: string
          created_at: string
          id: string
          message_id: string | null
          motivo_da_falha: string | null
          scheduled_for: string
          sent_at: string | null
          skipped_reason: string | null
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          cadence_step_id: string
          clinic_id: string
          contact_id: string
          created_at?: string
          id?: string
          message_id?: string | null
          motivo_da_falha?: string | null
          scheduled_for: string
          sent_at?: string | null
          skipped_reason?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          cadence_step_id?: string
          clinic_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          message_id?: string | null
          motivo_da_falha?: string | null
          scheduled_for?: string
          sent_at?: string | null
          skipped_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_run_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_run_cadence_step_id_fkey"
            columns: ["cadence_step_id"]
            isOneToOne: false
            referencedRelation: "cadence_step"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_run_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_run_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_run_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_step: {
        Row: {
          cadence_id: string
          clinic_id: string
          created_at: string
          fixed_body: string | null
          id: string
          media_filename: string | null
          media_mimetype: string | null
          media_path: string | null
          media_type: string | null
          offset_minutes: number
          stop_conditions: string[]
          template_id: string | null
          updated_at: string
          use_ai: boolean
        }
        Insert: {
          cadence_id: string
          clinic_id: string
          created_at?: string
          fixed_body?: string | null
          media_filename?: string | null
          media_mimetype?: string | null
          media_path?: string | null
          media_type?: string | null
          id?: string
          offset_minutes: number
          stop_conditions?: string[]
          template_id?: string | null
          updated_at?: string
          use_ai?: boolean
        }
        Update: {
          cadence_id?: string
          clinic_id?: string
          created_at?: string
          fixed_body?: string | null
          media_filename?: string | null
          media_mimetype?: string | null
          media_path?: string | null
          media_type?: string | null
          id?: string
          offset_minutes?: number
          stop_conditions?: string[]
          template_id?: string | null
          updated_at?: string
          use_ai?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cadence_step_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "cadence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_step_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_step_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_template"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_link: {
        Row: {
          active: boolean
          campaign: string | null
          channel: string
          clinic_id: string
          created_at: string
          default_message: string | null
          id: string
          keywords: string[]
          medium: string | null
          name: string
          origin: string | null
          token: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          campaign?: string | null
          channel: string
          clinic_id: string
          created_at?: string
          default_message?: string | null
          id?: string
          keywords?: string[]
          medium?: string | null
          name: string
          origin?: string | null
          token?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          campaign?: string | null
          channel?: string
          clinic_id?: string
          created_at?: string
          default_message?: string | null
          id?: string
          keywords?: string[]
          medium?: string | null
          name?: string
          origin?: string | null
          token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_link_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic: {
        Row: {
          allow_code_signup: boolean
          created_at: string
          e_de_teste: boolean
          id: string
          limite_de_numeros: number | null
          name: string
          slug: string
          spend_cap_action: string
          spend_cap_cents: number | null
          timezone: string
          waitlist_response_minutes: number
          waitlist_wave_size: number
          updated_at: string
        }
        Insert: {
          allow_code_signup?: boolean
          created_at?: string
          e_de_teste?: boolean
          id?: string
          limite_de_numeros?: number | null
          name: string
          slug: string
          spend_cap_action?: string
          spend_cap_cents?: number | null
          timezone?: string
          waitlist_response_minutes?: number
          waitlist_wave_size?: number
          updated_at?: string
        }
        Update: {
          allow_code_signup?: boolean
          created_at?: string
          e_de_teste?: boolean
          id?: string
          limite_de_numeros?: number | null
          name?: string
          slug?: string
          spend_cap_action?: string
          spend_cap_cents?: number | null
          timezone?: string
          waitlist_response_minutes?: number
          waitlist_wave_size?: number
          updated_at?: string
        }
        Relationships: []
      }
      clinic_access_code: {
        Row: {
          clinic_id: string
          code: string
          created_at: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          code: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          code?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_access_code_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_branding: {
        Row: {
          clinic_id: string
          created_at: string
          labels: Json
          logo_icon_dark: string | null
          logo_icon_light: string | null
          logo_wide_dark: string | null
          logo_wide_light: string | null
          primary_color: string
          product_name: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          labels?: Json
          logo_icon_dark?: string | null
          logo_icon_light?: string | null
          logo_wide_dark?: string | null
          logo_wide_light?: string | null
          primary_color?: string
          product_name?: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          labels?: Json
          logo_icon_dark?: string | null
          logo_icon_light?: string | null
          logo_wide_dark?: string | null
          logo_wide_light?: string | null
          primary_color?: string
          product_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_branding_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_member: {
        Row: {
          clinic_id: string
          created_at: string
          professional_id: string | null
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          professional_id?: string | null
          role: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          professional_id?: string | null
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_member_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_member_professional_fk"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      clinica_suspensa: {
        Row: {
          clinic_id: string
          motivo: string
          suspensa_em: string
          suspensa_por: string | null
        }
        Insert: {
          clinic_id: string
          motivo: string
          suspensa_em?: string
          suspensa_por?: string | null
        }
        Update: {
          clinic_id?: string
          motivo?: string
          suspensa_em?: string
          suspensa_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinica_suspensa_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      clique_do_site: {
        Row: {
          casado_em: string | null
          clinic_id: string
          codigo: string
          contact_id: string | null
          criado_em: string
          gad_source: string | null
          gbraid: string | null
          gclid: string | null
          google_adgroup_id: string | null
          google_campaign_id: string | null
          id: string
          site_host: string | null
          valido_ate: string
          wbraid: string | null
        }
        Insert: {
          casado_em?: string | null
          clinic_id: string
          codigo: string
          contact_id?: string | null
          criado_em?: string
          gad_source?: string | null
          gbraid?: string | null
          gclid?: string | null
          google_adgroup_id?: string | null
          google_campaign_id?: string | null
          id?: string
          site_host?: string | null
          valido_ate?: string
          wbraid?: string | null
        }
        Update: {
          casado_em?: string | null
          clinic_id?: string
          codigo?: string
          contact_id?: string | null
          criado_em?: string
          gad_source?: string | null
          gbraid?: string | null
          gclid?: string | null
          google_adgroup_id?: string | null
          google_campaign_id?: string | null
          id?: string
          site_host?: string | null
          valido_ate?: string
          wbraid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clique_do_site_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clique_do_site_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
        ]
      }
      contact: {
        Row: {
          birth_date: string | null
          clinic_id: string
          cpf: string | null
          created_at: string
          criado_por_importacao: boolean
          email: string | null
          first_contact_at: string
          funnel_stage: string
          funnel_stage_changed_at: string
          id: string
          inactive_since: string | null
          insurance_card: string | null
          insurance_id: string | null
          kind: string
          last_contact_at: string | null
          lost_reason: string | null
          lost_reason_note: string | null
          name: string | null
          no_show_count: number
          notes: string | null
          owner_user_id: string | null
          phone_e164: string
          phone_key: string | null
          ctwa_clid: string | null
          source_ad_id: string | null
          source_adset_id: string | null
          source_campaign_id: string | null
          source_campaign: string | null
          source_captured_at: string | null
          source_channel: string | null
          source_google_adgroup_id: string | null
          source_google_campaign_id: string | null
          source_medium: string | null
          source_method: string | null
          source_origin: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          clinic_id: string
          cpf?: string | null
          created_at?: string
          criado_por_importacao?: boolean
          email?: string | null
          first_contact_at?: string
          funnel_stage?: string
          funnel_stage_changed_at?: string
          id?: string
          inactive_since?: string | null
          insurance_card?: string | null
          insurance_id?: string | null
          kind?: string
          last_contact_at?: string | null
          lost_reason?: string | null
          lost_reason_note?: string | null
          name?: string | null
          no_show_count?: number
          notes?: string | null
          owner_user_id?: string | null
          phone_e164: string
          phone_key?: never
          ctwa_clid?: string | null
          source_ad_id?: string | null
          source_adset_id?: string | null
          source_campaign_id?: string | null
          source_campaign?: string | null
          source_captured_at?: string | null
          source_channel?: string | null
          source_google_adgroup_id?: string | null
          source_google_campaign_id?: string | null
          source_medium?: string | null
          source_method?: string | null
          source_origin?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          clinic_id?: string
          cpf?: string | null
          created_at?: string
          criado_por_importacao?: boolean
          email?: string | null
          first_contact_at?: string
          funnel_stage?: string
          funnel_stage_changed_at?: string
          id?: string
          inactive_since?: string | null
          insurance_card?: string | null
          insurance_id?: string | null
          kind?: string
          last_contact_at?: string | null
          lost_reason?: string | null
          lost_reason_note?: string | null
          name?: string | null
          no_show_count?: number
          notes?: string | null
          owner_user_id?: string | null
          phone_e164?: string
          phone_key?: never
          ctwa_clid?: string | null
          source_ad_id?: string | null
          source_adset_id?: string | null
          source_campaign_id?: string | null
          source_campaign?: string | null
          source_captured_at?: string | null
          source_channel?: string | null
          source_google_adgroup_id?: string | null
          source_google_campaign_id?: string | null
          source_medium?: string | null
          source_method?: string | null
          source_origin?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_insurance_fk"
            columns: ["insurance_id"]
            isOneToOne: false
            referencedRelation: "insurance"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_activity: {
        Row: {
          assignee_user_id: string | null
          automacao_id: string | null
          canceled_at: string | null
          canceled_by: string | null
          clinic_id: string
          completed_at: string | null
          completed_by: string | null
          contact_id: string
          conversation_id: string | null
          created_at: string
          created_by: string | null
          detalhes: string | null
          due_at: string | null
          due_on: string
          id: string
          origem: string
          status: string
          titulo: string
          updated_at: string
        }
        Insert: {
          assignee_user_id?: string | null
          automacao_id?: string | null
          canceled_at?: string | null
          canceled_by?: string | null
          clinic_id: string
          completed_at?: string | null
          completed_by?: string | null
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          detalhes?: string | null
          due_at?: string | null
          due_on: string
          id?: string
          origem?: string
          status?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          assignee_user_id?: string | null
          automacao_id?: string | null
          canceled_at?: string | null
          canceled_by?: string | null
          clinic_id?: string
          completed_at?: string | null
          completed_by?: string | null
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          detalhes?: string | null
          due_at?: string | null
          due_on?: string
          id?: string
          origem?: string
          status?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_activity_automacao_id_fkey"
            columns: ["automacao_id"]
            isOneToOne: false
            referencedRelation: "automacao_fluxo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_activity_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_activity_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_activity_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_consent: {
        Row: {
          active: boolean | null
          channel: string
          clinic_id: string
          contact_id: string
          created_at: string
          evidence: string | null
          granted_at: string
          id: string
          revoked_at: string | null
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          channel?: string
          clinic_id: string
          contact_id: string
          created_at?: string
          evidence?: string | null
          granted_at?: string
          id?: string
          revoked_at?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          channel?: string
          clinic_id?: string
          contact_id?: string
          created_at?: string
          evidence?: string | null
          granted_at?: string
          id?: string
          revoked_at?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_consent_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_consent_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_tag_def: {
        Row: {
          chave: string
          clinic_id: string
          created_at: string
          id: string
          nome: string
          tom: string
          updated_at: string
        }
        Insert: {
          chave: string
          clinic_id: string
          created_at?: string
          id?: string
          nome: string
          tom?: string
          updated_at?: string
        }
        Update: {
          chave?: string
          clinic_id?: string
          created_at?: string
          id?: string
          nome?: string
          tom?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_tag_def_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_event: {
        Row: {
          clinic_id: string
          contact_id: string
          created_at: string
          ctwa_clid: string | null
          currency: string
          erro: string | null
          event_id: string
          event_name: string
          id: string
          sent_at: string | null
          stage_chave: string
          status: string
          updated_at: string
          value_cents: number | null
        }
        Insert: {
          clinic_id: string
          contact_id: string
          created_at?: string
          ctwa_clid?: string | null
          currency?: string
          erro?: string | null
          event_id?: string
          event_name: string
          id?: string
          sent_at?: string | null
          stage_chave: string
          status?: string
          updated_at?: string
          value_cents?: number | null
        }
        Update: {
          clinic_id?: string
          contact_id?: string
          created_at?: string
          ctwa_clid?: string | null
          currency?: string
          erro?: string | null
          event_id?: string
          event_name?: string
          id?: string
          sent_at?: string | null
          stage_chave?: string
          status?: string
          updated_at?: string
          value_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conversion_event_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_event_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation: {
        Row: {
          assignee_user_id: string | null
          awaiting_reply: boolean
          clinic_id: string
          contact_id: string
          created_at: string
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_preview: string | null
          last_preview_author: string | null
          last_preview_author_user_id: string | null
          last_preview_kind: string | null
          status: string
          tags: string[]
          unread_count: number
          updated_at: string
          whatsapp_account_id: string
          window_expires_at: string | null
        }
        Insert: {
          assignee_user_id?: string | null
          awaiting_reply?: boolean
          clinic_id: string
          contact_id: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_preview?: string | null
          last_preview_author?: string | null
          last_preview_author_user_id?: string | null
          last_preview_kind?: string | null
          status?: string
          tags?: string[]
          unread_count?: number
          updated_at?: string
          whatsapp_account_id: string
          window_expires_at?: string | null
        }
        Update: {
          assignee_user_id?: string | null
          awaiting_reply?: boolean
          clinic_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_preview?: string | null
          last_preview_author?: string | null
          last_preview_author_user_id?: string | null
          last_preview_kind?: string | null
          status?: string
          tags?: string[]
          unread_count?: number
          updated_at?: string
          whatsapp_account_id?: string
          window_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_account"
            referencedColumns: ["id"]
          },
        ]
      }
      dados_informados_na_marcacao: {
        Row: {
          aplicado_em: string | null
          aplicado_por: string | null
          appointment_id: string | null
          carteirinha: string | null
          clinic_id: string
          contact_id: string
          conversation_id: string
          cpf: string | null
          created_at: string
          data_nascimento: string | null
          id: string
          job_id: string
          nome_completo: string | null
          para_o_titular: boolean
          slot_hold_id: string | null
          updated_at: string
        }
        Insert: {
          aplicado_em?: string | null
          aplicado_por?: string | null
          appointment_id?: string | null
          carteirinha?: string | null
          clinic_id: string
          contact_id: string
          conversation_id: string
          cpf?: string | null
          created_at?: string
          data_nascimento?: string | null
          id?: string
          job_id: string
          nome_completo?: string | null
          para_o_titular: boolean
          slot_hold_id?: string | null
          updated_at?: string
        }
        Update: {
          aplicado_em?: string | null
          aplicado_por?: string | null
          appointment_id?: string | null
          carteirinha?: string | null
          clinic_id?: string
          contact_id?: string
          conversation_id?: string
          cpf?: string | null
          created_at?: string
          data_nascimento?: string | null
          id?: string
          job_id?: string
          nome_completo?: string | null
          para_o_titular?: boolean
          slot_hold_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dados_informados_na_marcacao_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dados_informados_na_marcacao_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dados_informados_na_marcacao_slot_hold_id_fkey"
            columns: ["slot_hold_id"]
            isOneToOne: false
            referencedRelation: "slot_hold"
            referencedColumns: ["id"]
          },
        ]
      }
      etapa_pendente_da_passagem: {
        Row: {
          clinic_id: string
          contact_id: string
          conversation_id: string
          criada_em: string
          tentativas: number
        }
        Insert: {
          clinic_id: string
          contact_id: string
          conversation_id: string
          criada_em?: string
          tentativas?: number
        }
        Update: {
          clinic_id?: string
          contact_id?: string
          conversation_id?: string
          criada_em?: string
          tentativas?: number
        }
        Relationships: [
          {
            foreignKeyName: "etapa_pendente_da_passagem_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_stage_def: {
        Row: {
          chave: string
          clinic_id: string
          conversao_ativa: boolean
          created_at: string
          descricao: string | null
          icone: string
          id: string
          is_first_contact: boolean
          is_sale: boolean
          meta_event_name: string | null
          nome: string
          papel: string | null
          posicao: number
          termos_chave: string[]
          termos_de_quem: string
          tom: string
          updated_at: string
          value_cents: number | null
          value_source: string | null
        }
        Insert: {
          chave: string
          clinic_id: string
          conversao_ativa?: boolean
          created_at?: string
          descricao?: string | null
          icone?: string
          id?: string
          is_first_contact?: boolean
          is_sale?: boolean
          meta_event_name?: string | null
          nome: string
          papel?: string | null
          posicao: number
          termos_chave?: string[]
          termos_de_quem?: string
          tom?: string
          updated_at?: string
          value_cents?: number | null
          value_source?: string | null
        }
        Update: {
          chave?: string
          clinic_id?: string
          conversao_ativa?: boolean
          created_at?: string
          descricao?: string | null
          icone?: string
          id?: string
          is_first_contact?: boolean
          is_sale?: boolean
          meta_event_name?: string | null
          nome?: string
          papel?: string | null
          posicao?: number
          termos_chave?: string[]
          termos_de_quem?: string
          tom?: string
          updated_at?: string
          value_cents?: number | null
          value_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_stage_def_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      health_check: {
        Row: {
          created_at: string
          id: string
          label: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      ia_atendimento: {
        Row: {
          anterior: Json | null
          appointment_id: string | null
          clinic_id: string
          conversation_id: string
          created_at: string
          desfecho: string | null
          etapa: string
          falhas_seguidas: number
          horarios_oferecidos: Json
          id: string
          insurance_id: string | null
          intencao: string | null
          janela_desde: string
          job_id: string
          particular: boolean | null
          pedido_pendente: string | null
          pedido_pendente_em: string | null
          procedure_id: string | null
          professional_id: string | null
          slot_hold_id: string | null
          unit_id: string | null
          updated_at: string
          versao: number
        }
        Insert: {
          anterior?: Json | null
          appointment_id?: string | null
          clinic_id: string
          conversation_id: string
          created_at?: string
          desfecho?: string | null
          etapa?: string
          falhas_seguidas?: number
          horarios_oferecidos?: Json
          id?: string
          insurance_id?: string | null
          intencao?: string | null
          janela_desde: string
          job_id: string
          particular?: boolean | null
          pedido_pendente?: string | null
          pedido_pendente_em?: string | null
          procedure_id?: string | null
          professional_id?: string | null
          slot_hold_id?: string | null
          unit_id?: string | null
          updated_at?: string
          versao?: number
        }
        Update: {
          anterior?: Json | null
          appointment_id?: string | null
          clinic_id?: string
          conversation_id?: string
          created_at?: string
          desfecho?: string | null
          etapa?: string
          falhas_seguidas?: number
          horarios_oferecidos?: Json
          id?: string
          insurance_id?: string | null
          intencao?: string | null
          janela_desde?: string
          job_id?: string
          particular?: boolean | null
          pedido_pendente?: string | null
          pedido_pendente_em?: string | null
          procedure_id?: string | null
          professional_id?: string | null
          slot_hold_id?: string | null
          unit_id?: string | null
          updated_at?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "ia_atendimento_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_clinica_habilitada: {
        Row: {
          alterado_em: string
          alterado_por: string | null
          clinic_id: string
          estado: string
          motivo: string | null
        }
        Insert: {
          alterado_em?: string
          alterado_por?: string | null
          clinic_id: string
          estado: string
          motivo?: string | null
        }
        Update: {
          alterado_em?: string
          alterado_por?: string | null
          clinic_id?: string
          estado?: string
          motivo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ia_clinica_habilitada_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_contato_liberado: {
        Row: {
          alterado_por: string | null
          ativo: boolean
          clinic_id: string
          created_at: string
          forcado: boolean
          id: string
          phone_key: string
          rotulo: string | null
          updated_at: string
        }
        Insert: {
          alterado_por?: string | null
          ativo?: boolean
          clinic_id: string
          created_at?: string
          forcado?: boolean
          id?: string
          phone_key: string
          rotulo?: string | null
          updated_at?: string
        }
        Update: {
          alterado_por?: string | null
          ativo?: boolean
          clinic_id?: string
          created_at?: string
          forcado?: boolean
          id?: string
          phone_key?: string
          rotulo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_contato_liberado_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "ia_liberacao"
            referencedColumns: ["clinic_id"]
          },
        ]
      }
      ia_conversa_fora_do_horario: {
        Row: {
          clinic_id: string
          contact_id: string
          conversation_id: string
          criada_em: string
          desde: string
          origem: string
          phone_key: string
          whatsapp_account_id: string
        }
        Insert: {
          clinic_id: string
          contact_id: string
          conversation_id: string
          criada_em?: string
          desde?: string
          origem: string
          phone_key: string
          whatsapp_account_id: string
        }
        Update: {
          clinic_id?: string
          contact_id?: string
          conversation_id?: string
          criada_em?: string
          desde?: string
          origem?: string
          phone_key?: string
          whatsapp_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_conversa_fora_do_horario_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_interruptor: {
        Row: {
          alterado_em: string
          alterado_por: string | null
          id: boolean
          ligado: boolean
          motivo: string | null
        }
        Insert: {
          alterado_em?: string
          alterado_por?: string | null
          id?: boolean
          ligado?: boolean
          motivo?: string | null
        }
        Update: {
          alterado_em?: string
          alterado_por?: string | null
          id?: boolean
          ligado?: boolean
          motivo?: string | null
        }
        Relationships: []
      }
      ia_janela_da_conversa: {
        Row: {
          aberta_por: string
          clinic_id: string
          contact_id: string
          conversation_id: string
          desde: string
          phone_key: string
          updated_at: string
        }
        Insert: {
          aberta_por: string
          clinic_id: string
          contact_id: string
          conversation_id: string
          desde: string
          phone_key: string
          updated_at?: string
        }
        Update: {
          aberta_por?: string
          clinic_id?: string
          contact_id?: string
          conversation_id?: string
          desde?: string
          phone_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_janela_da_conversa_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_liberacao: {
        Row: {
          alterado_por: string | null
          clinic_id: string
          created_at: string
          liberada: boolean
          modo: string
          motivo: string | null
          pausada_pela_clinica: boolean
          teto_diario_centavos_usd: number
          teto_respostas_por_conversa_hora: number
          updated_at: string
        }
        Insert: {
          alterado_por?: string | null
          clinic_id: string
          created_at?: string
          liberada?: boolean
          modo?: string
          motivo?: string | null
          pausada_pela_clinica?: boolean
          teto_diario_centavos_usd?: number
          teto_respostas_por_conversa_hora?: number
          updated_at?: string
        }
        Update: {
          alterado_por?: string | null
          clinic_id?: string
          created_at?: string
          liberada?: boolean
          modo?: string
          motivo?: string | null
          pausada_pela_clinica?: boolean
          teto_diario_centavos_usd?: number
          teto_respostas_por_conversa_hora?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_liberacao_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_numero_liberado: {
        Row: {
          alterado_por: string | null
          ativo: boolean
          clinic_id: string
          created_at: string
          updated_at: string
          whatsapp_account_id: string
        }
        Insert: {
          alterado_por?: string | null
          ativo?: boolean
          clinic_id: string
          created_at?: string
          updated_at?: string
          whatsapp_account_id: string
        }
        Update: {
          alterado_por?: string | null
          ativo?: boolean
          clinic_id?: string
          created_at?: string
          updated_at?: string
          whatsapp_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_numero_liberado_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "ia_liberacao"
            referencedColumns: ["clinic_id"]
          },
          {
            foreignKeyName: "ia_numero_liberado_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_account"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_requisito_da_producao: {
        Row: {
          chave: string
          clinic_id: string | null
          evidencia: string
          id: string
          motivo_da_revogacao: string | null
          registrado_em: string
          registrado_por: string | null
          revogado_em: string | null
          revogado_por: string | null
        }
        Insert: {
          chave: string
          clinic_id?: string | null
          evidencia: string
          id?: string
          motivo_da_revogacao?: string | null
          registrado_em?: string
          registrado_por?: string | null
          revogado_em?: string | null
          revogado_por?: string | null
        }
        Update: {
          chave?: string
          clinic_id?: string | null
          evidencia?: string
          id?: string
          motivo_da_revogacao?: string | null
          registrado_em?: string
          registrado_por?: string | null
          revogado_em?: string | null
          revogado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ia_requisito_da_producao_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_uso: {
        Row: {
          clinic_id: string
          conversation_id: string | null
          created_at: string
          custo_microdolar: number
          id: string
          job_id: string | null
          modelo: string
          origem: string
          papel: string
          reserva: boolean
          tokens_cache_gravados: number
          tokens_cache_lidos: number
          tokens_entrada: number
          tokens_saida: number
        }
        Insert: {
          clinic_id: string
          conversation_id?: string | null
          created_at?: string
          custo_microdolar: number
          id?: string
          job_id?: string | null
          modelo: string
          origem: string
          papel: string
          reserva?: boolean
          tokens_cache_gravados?: number
          tokens_cache_lidos?: number
          tokens_entrada?: number
          tokens_saida?: number
        }
        Update: {
          clinic_id?: string
          conversation_id?: string | null
          created_at?: string
          custo_microdolar?: number
          id?: string
          job_id?: string | null
          modelo?: string
          origem?: string
          papel?: string
          reserva?: boolean
          tokens_cache_gravados?: number
          tokens_cache_lidos?: number
          tokens_entrada?: number
          tokens_saida?: number
        }
        Relationships: [
          {
            foreignKeyName: "ia_uso_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ia_uso_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          id: string
          name: string
          notes: string | null
          plan_name: string | null
          requires_card: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          plan_name?: string | null
          requires_card?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          plan_name?: string | null
          requires_card?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      job_queue: {
        Row: {
          attempts: number
          clinic_id: string
          created_at: string
          devolucoes: number
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          prioridade: number
          run_at: string
          status: string
          ultimo_motivo_devolucao: string | null
          updated_at: string
          whatsapp_account_id: string | null
        }
        Insert: {
          attempts?: number
          clinic_id: string
          created_at?: string
          devolucoes?: number
          id?: string
          kind: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          prioridade?: number
          run_at?: string
          status?: string
          ultimo_motivo_devolucao?: string | null
          updated_at?: string
          whatsapp_account_id?: string | null
        }
        Update: {
          attempts?: number
          clinic_id?: string
          created_at?: string
          devolucoes?: number
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          prioridade?: number
          run_at?: string
          status?: string
          ultimo_motivo_devolucao?: string | null
          updated_at?: string
          whatsapp_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_queue_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_queue_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_account"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_item: {
        Row: {
          active: boolean
          answer: string
          clinic_id: string
          created_at: string
          created_by: string | null
          id: string
          question: string
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          answer: string
          clinic_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          question: string
          source?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          answer?: string
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          question?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_item_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_preco: {
        Row: {
          cache_escrita_microdolar_por_milhao: number
          cache_leitura_microdolar_por_milhao: number
          created_at: string
          entrada_microdolar_por_milhao: number
          fonte: string
          modelo: string
          saida_microdolar_por_milhao: number
          updated_at: string
          vigente_desde: string
        }
        Insert: {
          cache_escrita_microdolar_por_milhao: number
          cache_leitura_microdolar_por_milhao: number
          created_at?: string
          entrada_microdolar_por_milhao: number
          fonte: string
          modelo: string
          saida_microdolar_por_milhao: number
          updated_at?: string
          vigente_desde: string
        }
        Update: {
          cache_escrita_microdolar_por_milhao?: number
          cache_leitura_microdolar_por_milhao?: number
          created_at?: string
          entrada_microdolar_por_milhao?: number
          fonte?: string
          modelo?: string
          saida_microdolar_por_milhao?: number
          updated_at?: string
          vigente_desde?: string
        }
        Relationships: []
      }
      membro_implementador: {
        Row: {
          clinic_id: string
          marcado_em: string
          marcado_por: string | null
          user_id: string
        }
        Insert: {
          clinic_id: string
          marcado_em?: string
          marcado_por?: string | null
          user_id: string
        }
        Update: {
          clinic_id?: string
          marcado_em?: string
          marcado_por?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membro_implementador_clinic_id_user_id_fkey"
            columns: ["clinic_id", "user_id"]
            isOneToOne: true
            referencedRelation: "clinic_member"
            referencedColumns: ["clinic_id", "user_id"]
          },
        ]
      }
      mensagem_agendada: {
        Row: {
          atividade_id: string | null
          cancelada_em: string | null
          cancelada_por: string | null
          clinic_id: string
          contact_id: string
          conversation_id: string | null
          criada_em: string
          criada_por: string
          dispensada_em: string | null
          dispensada_por: string | null
          editada_em: string | null
          editada_por: string | null
          encerrada_em: string | null
          enviada_em: string | null
          enviar_em: string
          id: string
          job_id: string | null
          message_id: string | null
          motivo: string | null
          situacao: string
          texto: string | null
          updated_at: string
          whatsapp_account_id: string
        }
        Insert: {
          atividade_id?: string | null
          cancelada_em?: string | null
          cancelada_por?: string | null
          clinic_id: string
          contact_id: string
          conversation_id?: string | null
          criada_em?: string
          criada_por: string
          dispensada_em?: string | null
          dispensada_por?: string | null
          editada_em?: string | null
          editada_por?: string | null
          encerrada_em?: string | null
          enviada_em?: string | null
          enviar_em: string
          id?: string
          job_id?: string | null
          message_id?: string | null
          motivo?: string | null
          situacao?: string
          texto?: string | null
          updated_at?: string
          whatsapp_account_id: string
        }
        Update: {
          atividade_id?: string | null
          cancelada_em?: string | null
          cancelada_por?: string | null
          clinic_id?: string
          contact_id?: string
          conversation_id?: string | null
          criada_em?: string
          criada_por?: string
          dispensada_em?: string | null
          dispensada_por?: string | null
          editada_em?: string | null
          editada_por?: string | null
          encerrada_em?: string | null
          enviada_em?: string | null
          enviar_em?: string
          id?: string
          job_id?: string | null
          message_id?: string | null
          motivo?: string | null
          situacao?: string
          texto?: string | null
          updated_at?: string
          whatsapp_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensagem_agendada_atividade_id_fkey"
            columns: ["atividade_id"]
            isOneToOne: false
            referencedRelation: "contact_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagem_agendada_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagem_agendada_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagem_agendada_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagem_agendada_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagem_agendada_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagem_agendada_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_account"
            referencedColumns: ["id"]
          },
        ]
      }
      message: {
        Row: {
          author: string
          author_user_id: string | null
          billable: boolean
          body: string | null
          clinic_id: string
          content_type: string
          conversation_id: string
          cost_cents: number | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_escopo: string | null
          deleted_source: string | null
          delivery_status: string | null
          direction: string
          enviada_no_aparelho_em: string | null
          error_code: string | null
          id: string
          is_internal_note: boolean
          job_id: string | null
          media_filename: string | null
          media_mimetype: string | null
          media_url: string | null
          pelo_celular: boolean
          pricing_category: string | null
          reply_to_message_id: string | null
          reply_to_wa_message_id: string | null
          template_id: string | null
          transcript: string | null
          updated_at: string
          wa_message_id: string | null
          whatsapp_account_id: string
        }
        Insert: {
          author: string
          author_user_id?: string | null
          billable?: boolean
          body?: string | null
          clinic_id: string
          content_type?: string
          conversation_id: string
          cost_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_escopo?: string | null
          deleted_source?: string | null
          delivery_status?: string | null
          direction: string
          enviada_no_aparelho_em?: string | null
          error_code?: string | null
          id?: string
          is_internal_note?: boolean
          job_id?: string | null
          media_filename?: string | null
          media_mimetype?: string | null
          media_url?: string | null
          pelo_celular?: boolean
          pricing_category?: string | null
          reply_to_message_id?: string | null
          reply_to_wa_message_id?: string | null
          template_id?: string | null
          transcript?: string | null
          updated_at?: string
          wa_message_id?: string | null
          whatsapp_account_id: string
        }
        Update: {
          author?: string
          author_user_id?: string | null
          billable?: boolean
          body?: string | null
          clinic_id?: string
          content_type?: string
          conversation_id?: string
          cost_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_escopo?: string | null
          deleted_source?: string | null
          delivery_status?: string | null
          direction?: string
          enviada_no_aparelho_em?: string | null
          error_code?: string | null
          id?: string
          is_internal_note?: boolean
          job_id?: string | null
          media_filename?: string | null
          media_mimetype?: string | null
          media_url?: string | null
          pelo_celular?: boolean
          pricing_category?: string | null
          reply_to_message_id?: string | null
          reply_to_wa_message_id?: string | null
          template_id?: string | null
          transcript?: string | null
          updated_at?: string
          wa_message_id?: string | null
          whatsapp_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_account"
            referencedColumns: ["id"]
          },
        ]
      }
      message_apagada: {
        Row: {
          apagada_em: string
          apagada_por: string | null
          body: string | null
          clinic_id: string
          content_type: string | null
          conversation_id: string
          escopo: string
          media_url: string | null
          message_id: string
          origem: string
          transcript: string | null
          wa_message_id: string | null
        }
        Insert: {
          apagada_em?: string
          apagada_por?: string | null
          body?: string | null
          clinic_id: string
          content_type?: string | null
          conversation_id: string
          escopo: string
          media_url?: string | null
          message_id: string
          origem: string
          transcript?: string | null
          wa_message_id?: string | null
        }
        Update: {
          apagada_em?: string
          apagada_por?: string | null
          body?: string | null
          clinic_id?: string
          content_type?: string | null
          conversation_id?: string
          escopo?: string
          media_url?: string | null
          message_id?: string
          origem?: string
          transcript?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_apagada_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_apagada_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads_account: {
        Row: {
          ad_account_id: string | null
          clinic_id: string
          created_at: string
          envio_ativado: boolean
          modo_user_data: string | null
          pixel_id: string | null
          send_unmatched: boolean
          test_event_code: string | null
          updated_at: string
          whatsapp_business_account_id: string | null
        }
        Insert: {
          ad_account_id?: string | null
          clinic_id: string
          created_at?: string
          envio_ativado?: boolean
          modo_user_data?: string | null
          pixel_id?: string | null
          send_unmatched?: boolean
          test_event_code?: string | null
          updated_at?: string
          whatsapp_business_account_id?: string | null
        }
        Update: {
          ad_account_id?: string | null
          clinic_id?: string
          created_at?: string
          envio_ativado?: boolean
          modo_user_data?: string | null
          pixel_id?: string | null
          send_unmatched?: boolean
          test_event_code?: string | null
          updated_at?: string
          whatsapp_business_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_account_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads_account_secret: {
        Row: {
          capi_access_token: string | null
          clinic_id: string
          created_at: string
          insights_access_token: string | null
          updated_at: string
        }
        Insert: {
          capi_access_token?: string | null
          clinic_id: string
          created_at?: string
          insights_access_token?: string | null
          updated_at?: string
        }
        Update: {
          capi_access_token?: string | null
          clinic_id?: string
          created_at?: string
          insights_access_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_account_secret_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_anuncio: {
        Row: {
          ad_account_id: string
          ad_id: string
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          atualizado_em: string
          campaign_id: string
          campaign_name: string | null
          clinic_id: string
          consultado_em: string | null
          origem: string
          ultimo_dia_com_entrega: string | null
        }
        Insert: {
          ad_account_id: string
          ad_id: string
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          atualizado_em?: string
          campaign_id: string
          campaign_name?: string | null
          clinic_id: string
          consultado_em?: string | null
          origem?: string
          ultimo_dia_com_entrega?: string | null
        }
        Update: {
          ad_account_id?: string
          ad_id?: string
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          atualizado_em?: string
          campaign_id?: string
          campaign_name?: string | null
          clinic_id?: string
          consultado_em?: string | null
          origem?: string
          ultimo_dia_com_entrega?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_anuncio_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_anuncio_recusado: {
        Row: {
          ad_account_id: string
          ad_id: string
          clinic_id: string
          codigo_da_meta: number | null
          motivo: string
          primeira_recusa_em: string
          recusado_em: string
          tentar_de_novo_em: string | null
          tentativas: number
          token_sha256: string
        }
        Insert: {
          ad_account_id: string
          ad_id: string
          clinic_id: string
          codigo_da_meta?: number | null
          motivo: string
          primeira_recusa_em?: string
          recusado_em?: string
          tentar_de_novo_em?: string | null
          tentativas?: number
          token_sha256: string
        }
        Update: {
          ad_account_id?: string
          ad_id?: string
          clinic_id?: string
          codigo_da_meta?: number | null
          motivo?: string
          primeira_recusa_em?: string
          recusado_em?: string
          tentar_de_novo_em?: string | null
          tentativas?: number
          token_sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_anuncio_recusado_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_gasto_conta_diario: {
        Row: {
          ad_account_id: string
          clinic_id: string
          currency: string
          dia: string
          sincronizado_em: string
          spend_cents: number
        }
        Insert: {
          ad_account_id: string
          clinic_id: string
          currency: string
          dia: string
          sincronizado_em?: string
          spend_cents: number
        }
        Update: {
          ad_account_id?: string
          clinic_id?: string
          currency?: string
          dia?: string
          sincronizado_em?: string
          spend_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "meta_gasto_conta_diario_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_gasto_diario: {
        Row: {
          ad_account_id: string
          ad_id: string
          adset_id: string | null
          campaign_id: string
          campaign_name: string | null
          clinic_id: string
          currency: string
          dia: string
          sincronizado_em: string
          spend_cents: number
        }
        Insert: {
          ad_account_id: string
          ad_id: string
          adset_id?: string | null
          campaign_id: string
          campaign_name?: string | null
          clinic_id: string
          currency: string
          dia: string
          sincronizado_em?: string
          spend_cents: number
        }
        Update: {
          ad_account_id?: string
          ad_id?: string
          adset_id?: string | null
          campaign_id?: string
          campaign_name?: string | null
          clinic_id?: string
          currency?: string
          dia?: string
          sincronizado_em?: string
          spend_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "meta_gasto_diario_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_gasto_leitura: {
        Row: {
          ad_account_id: string | null
          atualizacao_pedida_em: string | null
          clinic_id: string
          codigo_da_meta: number | null
          conta_ativa: boolean | null
          created_at: string
          fuso_da_conta: string | null
          lido_ate: string | null
          lido_desde: string | null
          moeda: string | null
          nome_da_conta: string | null
          problema: string | null
          sincronizado_em: string | null
          situacao: string
          tentado_em: string | null
          testada_em: string | null
          ultimo_diario_dia: string | null
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          atualizacao_pedida_em?: string | null
          clinic_id: string
          codigo_da_meta?: number | null
          conta_ativa?: boolean | null
          created_at?: string
          fuso_da_conta?: string | null
          lido_ate?: string | null
          lido_desde?: string | null
          moeda?: string | null
          nome_da_conta?: string | null
          problema?: string | null
          sincronizado_em?: string | null
          situacao?: string
          tentado_em?: string | null
          testada_em?: string | null
          ultimo_diario_dia?: string | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          atualizacao_pedida_em?: string | null
          clinic_id?: string
          codigo_da_meta?: number | null
          conta_ativa?: boolean | null
          created_at?: string
          fuso_da_conta?: string | null
          lido_ate?: string | null
          lido_desde?: string | null
          moeda?: string | null
          nome_da_conta?: string | null
          problema?: string | null
          sincronizado_em?: string | null
          situacao?: string
          tentado_em?: string | null
          testada_em?: string | null
          ultimo_diario_dia?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_gasto_leitura_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      message_pricing: {
        Row: {
          category: string
          cents: number
          created_at: string
          currency: string
          id: string
          valid_from: string
        }
        Insert: {
          category: string
          cents: number
          created_at?: string
          currency?: string
          id?: string
          valid_from: string
        }
        Update: {
          category?: string
          cents?: number
          created_at?: string
          currency?: string
          id?: string
          valid_from?: string
        }
        Relationships: []
      }
      message_template: {
        Row: {
          body: string
          buttons: Json | null
          category: string
          clinic_id: string
          created_at: string
          id: string
          language: string
          meta_status: string
          meta_template_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          body: string
          buttons?: Json | null
          category: string
          clinic_id: string
          created_at?: string
          id?: string
          language?: string
          meta_status?: string
          meta_template_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          body?: string
          buttons?: Json | null
          category?: string
          clinic_id?: string
          created_at?: string
          id?: string
          language?: string
          meta_status?: string
          meta_template_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_template_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      no_show_baseline: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          measured_from: string
          measured_to: string
          note: string | null
          rate_percent: number
          registered_by: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          measured_from: string
          measured_to: string
          note?: string | null
          rate_percent: number
          registered_by: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          measured_from?: string
          measured_to?: string
          note?: string | null
          rate_percent?: number
          registered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "no_show_baseline_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      nota_interna_da_clinica: {
        Row: {
          autor_user_id: string | null
          clinic_id: string
          criada_em: string
          id: string
          texto: string
        }
        Insert: {
          autor_user_id?: string | null
          clinic_id: string
          criada_em?: string
          id?: string
          texto: string
        }
        Update: {
          autor_user_id?: string | null
          clinic_id?: string
          criada_em?: string
          id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "nota_interna_da_clinica_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      objetivo_de_conversao: {
        Row: {
          clinic_id: string
          created_at: string
          definido_por: string | null
          percentual: number
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          definido_por?: string | null
          percentual: number
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          definido_por?: string | null
          percentual?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "objetivo_de_conversao_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      package: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          id: string
          name: string
          price_cents: number
          procedure_id: string | null
          sessions: number | null
          updated_at: string
          validity_days: number | null
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          name: string
          price_cents: number
          procedure_id?: string | null
          sessions?: number | null
          updated_at?: string
          validity_days?: number | null
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          id?: string
          name?: string
          price_cents?: number
          procedure_id?: string | null
          sessions?: number | null
          updated_at?: string
          validity_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "package_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
        ]
      }
      package_balance: {
        Row: {
          clinic_id: string
          contact_id: string
          created_at: string
          expires_at: string | null
          id: string
          package_id: string
          sessions_total: number | null
          sessions_used: number
          updated_at: string
        }
        Insert: {
          clinic_id: string
          contact_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id: string
          sessions_total?: number | null
          sessions_used?: number
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          contact_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id?: string
          sessions_total?: number | null
          sessions_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_balance_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "package"
            referencedColumns: ["id"]
          },
        ]
      }
      package_balance_adjustment: {
        Row: {
          clinic_id: string
          contact_id: string
          created_at: string
          expires_at_after: string | null
          expires_at_before: string | null
          id: string
          kind: string
          package_balance_id: string | null
          package_balance_item_id: string | null
          package_id: string
          procedure_id: string | null
          reason: string
          sessions_total: number
          sessions_used_after: number | null
          sessions_used_before: number
          user_id: string
        }
        Insert: {
          clinic_id: string
          contact_id: string
          created_at?: string
          expires_at_after?: string | null
          expires_at_before?: string | null
          id?: string
          kind: string
          package_balance_id?: string | null
          package_balance_item_id?: string | null
          package_id: string
          procedure_id?: string | null
          reason: string
          sessions_total: number
          sessions_used_after?: number | null
          sessions_used_before: number
          user_id: string
        }
        Update: {
          clinic_id?: string
          contact_id?: string
          created_at?: string
          expires_at_after?: string | null
          expires_at_before?: string | null
          id?: string
          kind?: string
          package_balance_id?: string | null
          package_balance_item_id?: string | null
          package_id?: string
          procedure_id?: string | null
          reason?: string
          sessions_total?: number
          sessions_used_after?: number | null
          sessions_used_before?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_balance_adjustment_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_adjustment_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_adjustment_package_balance_id_fkey"
            columns: ["package_balance_id"]
            isOneToOne: false
            referencedRelation: "package_balance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_adjustment_package_balance_item_id_fkey"
            columns: ["package_balance_item_id"]
            isOneToOne: false
            referencedRelation: "package_balance_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_adjustment_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "package"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_adjustment_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
        ]
      }
      package_balance_item: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          package_balance_id: string
          procedure_id: string
          sessions_total: number
          sessions_used: number
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          package_balance_id: string
          procedure_id: string
          sessions_total: number
          sessions_used?: number
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          package_balance_id?: string
          procedure_id?: string
          sessions_total?: number
          sessions_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_balance_item_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_item_package_balance_id_fkey"
            columns: ["package_balance_id"]
            isOneToOne: false
            referencedRelation: "package_balance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_item_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
        ]
      }
      package_item: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          package_id: string
          procedure_id: string
          sessions: number
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          package_id: string
          procedure_id: string
          sessions: number
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          package_id?: string
          procedure_id?: string
          sessions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_item_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_item_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "package"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_item_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure: {
        Row: {
          active: boolean
          base_price_cents: number | null
          bookable_by_ai: boolean
          clinic_id: string
          created_at: string
          default_duration_min: number
          description: string | null
          ia_pode_informar: boolean
          id: string
          name: string
          prep_instructions: string | null
          requires_evaluation: boolean
          resource_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_price_cents?: number | null
          bookable_by_ai?: boolean
          clinic_id: string
          created_at?: string
          default_duration_min?: number
          description?: string | null
          ia_pode_informar?: boolean
          id?: string
          name: string
          prep_instructions?: string | null
          requires_evaluation?: boolean
          resource_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_price_cents?: number | null
          bookable_by_ai?: boolean
          clinic_id?: string
          created_at?: string
          default_duration_min?: number
          description?: string | null
          ia_pode_informar?: boolean
          id?: string
          name?: string
          prep_instructions?: string | null
          requires_evaluation?: boolean
          resource_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedure_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resource"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_insurance: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          insurance_id: string
          procedure_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          insurance_id: string
          procedure_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          insurance_id?: string
          procedure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedure_insurance_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_insurance_insurance_id_fkey"
            columns: ["insurance_id"]
            isOneToOne: false
            referencedRelation: "insurance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_insurance_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_requirement: {
        Row: {
          ativo: boolean
          clinic_id: string
          created_at: string
          id: string
          insurance_id: string | null
          procedure_id: string
          texto_ao_paciente: string | null
          tipo: string
          updated_at: string
          valor_inteiro: number | null
        }
        Insert: {
          ativo?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          insurance_id?: string | null
          procedure_id: string
          texto_ao_paciente?: string | null
          tipo: string
          updated_at?: string
          valor_inteiro?: number | null
        }
        Update: {
          ativo?: boolean
          clinic_id?: string
          created_at?: string
          id?: string
          insurance_id?: string | null
          procedure_id?: string
          texto_ao_paciente?: string | null
          tipo?: string
          updated_at?: string
          valor_inteiro?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "procedure_requirement_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_requirement_insurance_id_fkey"
            columns: ["insurance_id"]
            isOneToOne: false
            referencedRelation: "insurance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_requirement_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
        ]
      }
      product_admin: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      professional: {
        Row: {
          active: boolean
          calendar_color: string | null
          clinic_id: string
          council_number: string | null
          council_type: string | null
          created_at: string
          grade_minutos: number | null
          id: string
          idade_maxima: number | null
          idade_minima: number | null
          name: string
          photo_url: string | null
          specialties: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          calendar_color?: string | null
          clinic_id: string
          council_number?: string | null
          council_type?: string | null
          created_at?: string
          grade_minutos?: number | null
          id?: string
          idade_maxima?: number | null
          idade_minima?: number | null
          name: string
          photo_url?: string | null
          specialties?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          calendar_color?: string | null
          clinic_id?: string
          council_number?: string | null
          council_type?: string | null
          created_at?: string
          grade_minutos?: number | null
          id?: string
          idade_maxima?: number | null
          idade_minima?: number | null
          name?: string
          photo_url?: string | null
          specialties?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_block: {
        Row: {
          blocks_overbooking: boolean
          clinic_id: string
          created_at: string
          ends_at: string
          id: string
          professional_id: string
          reason: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          blocks_overbooking?: boolean
          clinic_id: string
          created_at?: string
          ends_at: string
          id?: string
          professional_id: string
          reason: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          blocks_overbooking?: boolean
          clinic_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          professional_id?: string
          reason?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_block_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_block_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_insurance: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          insurance_id: string
          professional_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          insurance_id: string
          professional_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          insurance_id?: string
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_insurance_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_insurance_insurance_id_fkey"
            columns: ["insurance_id"]
            isOneToOne: false
            referencedRelation: "insurance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_insurance_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_schedule: {
        Row: {
          clinic_id: string
          created_at: string
          ends_at: string
          id: string
          professional_id: string
          starts_at: string
          unit_id: string | null
          updated_at: string
          weekday: number
        }
        Insert: {
          clinic_id: string
          created_at?: string
          ends_at: string
          id?: string
          professional_id: string
          starts_at: string
          unit_id?: string | null
          updated_at?: string
          weekday: number
        }
        Update: {
          clinic_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          professional_id?: string
          starts_at?: string
          unit_id?: string | null
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "professional_schedule_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_schedule_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_schedule_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "unit"
            referencedColumns: ["id"]
          },
        ]
      }
      profile: {
        Row: {
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rastreio_do_site: {
        Row: {
          ativo: boolean
          chave: string
          chave_trocada_em: string
          clinic_id: string
          frases: string[]
          ultimo_clique_em: string | null
        }
        Insert: {
          ativo?: boolean
          chave?: string
          chave_trocada_em?: string
          clinic_id: string
          frases?: string[]
          ultimo_clique_em?: string | null
        }
        Update: {
          ativo?: boolean
          chave?: string
          chave_trocada_em?: string
          clinic_id?: string
          frases?: string[]
          ultimo_clique_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rastreio_do_site_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      resource: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          id: string
          kind: string
          name: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          kind: string
          name: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "unit"
            referencedColumns: ["id"]
          },
        ]
      }
      resposta_rapida: {
        Row: {
          atalho: string
          ativo: boolean
          clinic_id: string
          corpo: string
          created_at: string
          created_by: string | null
          id: string
          posicao: number
          titulo: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          atalho: string
          ativo?: boolean
          clinic_id: string
          corpo: string
          created_at?: string
          created_by?: string | null
          id?: string
          posicao?: number
          titulo: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          atalho?: string
          ativo?: boolean
          clinic_id?: string
          corpo?: string
          created_at?: string
          created_by?: string | null
          id?: string
          posicao?: number
          titulo?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resposta_rapida_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      service_link: {
        Row: {
          active: boolean
          bookable_by_ai: boolean
          clinic_id: string
          covered_by_insurance: boolean
          created_at: string
          duration_min: number
          id: string
          insurance_id: string | null
          price_cents: number | null
          procedure_id: string
          professional_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          bookable_by_ai?: boolean
          clinic_id: string
          covered_by_insurance?: boolean
          created_at?: string
          duration_min: number
          id?: string
          insurance_id?: string | null
          price_cents?: number | null
          procedure_id: string
          professional_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          bookable_by_ai?: boolean
          clinic_id?: string
          covered_by_insurance?: boolean
          created_at?: string
          duration_min?: number
          id?: string
          insurance_id?: string | null
          price_cents?: number | null
          procedure_id?: string
          professional_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_link_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_link_insurance_id_fkey"
            columns: ["insurance_id"]
            isOneToOne: false
            referencedRelation: "insurance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_link_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_link_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_hold: {
        Row: {
          appointment_id: string | null
          clinic_id: string
          consumido_em: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string
          ends_at: string
          expires_at: string
          id: string
          job_id: string | null
          job_id_do_agendar: string | null
          professional_id: string
          service_link_id: string | null
          starts_at: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          clinic_id: string
          consumido_em?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string
          ends_at: string
          expires_at: string
          id?: string
          job_id?: string | null
          job_id_do_agendar?: string | null
          professional_id: string
          service_link_id?: string | null
          starts_at: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          clinic_id?: string
          consumido_em?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string
          ends_at?: string
          expires_at?: string
          id?: string
          job_id?: string | null
          job_id_do_agendar?: string | null
          professional_id?: string
          service_link_id?: string | null
          starts_at?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_hold_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_hold_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_hold_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_hold_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_hold_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_hold_service_link_id_fkey"
            columns: ["service_link_id"]
            isOneToOne: false
            referencedRelation: "service_link"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_hold_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "unit"
            referencedColumns: ["id"]
          },
        ]
      }
      termo_eco_visto: {
        Row: {
          clinic_id: string
          created_at: string
          wa_message_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          wa_message_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          wa_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "termo_eco_visto_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      unit: {
        Row: {
          acessibilidade: string | null
          active: boolean
          address: string | null
          bairro: string | null
          cep: string | null
          cidade: string | null
          clinic_id: string
          complemento: string | null
          created_at: string
          estacionamento: string | null
          horario_de_funcionamento: Json | null
          id: string
          link_do_mapa: string | null
          logradouro: string | null
          name: string
          numero: string | null
          observacao_ao_paciente: string | null
          phone: string | null
          referencia: string | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          acessibilidade?: string | null
          active?: boolean
          address?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          clinic_id: string
          complemento?: string | null
          created_at?: string
          estacionamento?: string | null
          horario_de_funcionamento?: Json | null
          id?: string
          link_do_mapa?: string | null
          logradouro?: string | null
          name: string
          numero?: string | null
          observacao_ao_paciente?: string | null
          phone?: string | null
          referencia?: string | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          acessibilidade?: string | null
          active?: boolean
          address?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          clinic_id?: string
          complemento?: string | null
          created_at?: string
          estacionamento?: string | null
          horario_de_funcionamento?: Json | null
          id?: string
          link_do_mapa?: string | null
          logradouro?: string | null
          name?: string
          numero?: string | null
          observacao_ao_paciente?: string | null
          phone?: string | null
          referencia?: string | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          active: boolean
          clinic_id: string
          contact_id: string
          created_at: string
          id: string
          preferred_shifts: string[]
          preferred_weekdays: number[]
          priority: number
          procedure_id: string | null
          professional_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          clinic_id: string
          contact_id: string
          created_at?: string
          id?: string
          preferred_shifts?: string[]
          preferred_weekdays?: number[]
          priority?: number
          procedure_id?: string | null
          professional_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          preferred_shifts?: string[]
          preferred_weekdays?: number[]
          priority?: number
          procedure_id?: string | null
          professional_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_offer: {
        Row: {
          appointment_id: string | null
          clinic_id: string
          created_at: string
          declined_by: string[]
          expires_at: string
          id: string
          matched_waitlist_ids: string[]
          offered_to: string[]
          professional_id: string
          responded_at: string | null
          responded_by: string | null
          slot_ends_at: string
          slot_starts_at: string
          source_appointment_id: string
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          clinic_id: string
          created_at?: string
          declined_by?: string[]
          expires_at: string
          id?: string
          matched_waitlist_ids?: string[]
          offered_to: string[]
          professional_id: string
          responded_at?: string | null
          responded_by?: string | null
          slot_ends_at: string
          slot_starts_at: string
          source_appointment_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          clinic_id?: string
          created_at?: string
          declined_by?: string[]
          expires_at?: string
          id?: string
          matched_waitlist_ids?: string[]
          offered_to?: string[]
          professional_id?: string
          responded_at?: string | null
          responded_by?: string | null
          slot_ends_at?: string
          slot_starts_at?: string
          source_appointment_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_offer_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_offer_source_appointment_id_fkey"
            columns: ["source_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_offer_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_offer_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_offer_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_account: {
        Row: {
          business_verified: boolean
          clinic_id: string
          connected_at: string | null
          connection_status: string
          cor: string
          created_at: string
          disconnected_at: string | null
          display_phone: string | null
          id: string
          instance_id: string | null
          messaging_limit: string | null
          next_bulk_send_at: string | null
          next_send_at: string | null
          nome: string
          phone_number_id: string | null
          principal: boolean
          provider: string
          quality_rating: string | null
          removido_em: string | null
          removido_por: string | null
          server_url: string | null
          unit_id: string | null
          updated_at: string
          waba_id: string | null
        }
        Insert: {
          business_verified?: boolean
          clinic_id: string
          connected_at?: string | null
          connection_status?: string
          cor?: string
          created_at?: string
          disconnected_at?: string | null
          display_phone?: string | null
          id?: string
          instance_id?: string | null
          messaging_limit?: string | null
          next_bulk_send_at?: string | null
          next_send_at?: string | null
          nome?: string
          phone_number_id?: string | null
          principal?: boolean
          provider?: string
          quality_rating?: string | null
          removido_em?: string | null
          removido_por?: string | null
          server_url?: string | null
          unit_id?: string | null
          updated_at?: string
          waba_id?: string | null
        }
        Update: {
          business_verified?: boolean
          clinic_id?: string
          connected_at?: string | null
          connection_status?: string
          cor?: string
          created_at?: string
          disconnected_at?: string | null
          display_phone?: string | null
          id?: string
          instance_id?: string | null
          messaging_limit?: string | null
          next_bulk_send_at?: string | null
          next_send_at?: string | null
          nome?: string
          phone_number_id?: string | null
          principal?: boolean
          provider?: string
          quality_rating?: string | null
          removido_em?: string | null
          removido_por?: string | null
          server_url?: string | null
          unit_id?: string | null
          updated_at?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_account_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_account_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "unit"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_account_secret: {
        Row: {
          account_id: string
          clinic_id: string
          created_at: string
          instance_token: string | null
          qr_code: string | null
          qr_code_expires_at: string | null
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          account_id: string
          clinic_id: string
          created_at?: string
          instance_token?: string | null
          qr_code?: string | null
          qr_code_expires_at?: string | null
          updated_at?: string
          webhook_secret?: string
        }
        Update: {
          account_id?: string
          clinic_id?: string
          created_at?: string
          instance_token?: string | null
          qr_code?: string | null
          qr_code_expires_at?: string | null
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_account_secret_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_account_secret_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_envio_automatico: {
        Row: {
          clinic_id: string
          conta_fixa_id: string | null
          created_at: string
          modo: string
          tipo: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          conta_fixa_id?: string | null
          created_at?: string
          modo?: string
          tipo: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          conta_fixa_id?: string | null
          created_at?: string
          modo?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_envio_automatico_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_envio_automatico_conta_fixa_id_fkey"
            columns: ["conta_fixa_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_account"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_heartbeat: {
        Row: {
          batida_em: string
          criado_em: string
          ultimo_erro: string | null
          ultimo_erro_em: string | null
          ultimo_lote: number
          worker_id: string
        }
        Insert: {
          batida_em?: string
          criado_em?: string
          ultimo_erro?: string | null
          ultimo_erro_em?: string | null
          ultimo_lote?: number
          worker_id: string
        }
        Update: {
          batida_em?: string
          criado_em?: string
          ultimo_erro?: string | null
          ultimo_erro_em?: string | null
          ultimo_lote?: number
          worker_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acertar_gasto_da_ia: {
        Args: { p_linhas: Json; p_reserva: string }
        Returns: undefined
      }
      admins_plenos_ativos: { Args: { p_clinic_id: string }; Returns: number }
      adotar_eco_do_envio: {
        Args: {
          p_clinic_id: string
          p_message_id: string
          p_wa_message_id: string
        }
        Returns: boolean
      }
      agenda_do_periodo: {
        Args: {
          p_ate: string
          p_clinic_id: string
          p_de: string
          p_de_anterior?: string
          p_professional_id?: string
        }
        Returns: Json
      }
      ajustar_saldo_de_pacote:
        | {
            Args: {
              p_balance_id: string
              p_expires_at: string
              p_itens: Json
              p_reason: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_balance_id: string
              p_expires_at: string
              p_reason: string
              p_sessions_used: number
            }
            Returns: undefined
          }
      agente_exigir_equipe_conduzza: { Args: never; Returns: undefined }
      agente_exigir_fase_controlada: {
        Args: { p_clinic_id: string }
        Returns: undefined
      }
      agente_exigir_quem_configura: {
        Args: { p_clinic_id: string }
        Returns: undefined
      }
      agente_garantir_rascunho: {
        Args: { p_clinic_id: string }
        Returns: string
      }
      agendar_pela_ia: {
        Args: {
          p_clinic_id: string
          p_conversation_id: string
          p_job_id: string
        }
        Returns: Json
      }
      alcance_das_reguas_de_followup: {
        Args: { p_clinic_id: string }
        Returns: Json
      }
      anuncios_do_periodo: {
        Args: { p_ate: string; p_clinic_id: string; p_de: string }
        Returns: Json
      }
      anuncios_meta_a_resolver: {
        Args: {
          p_ad_account_id: string
          p_agora?: string
          p_clinic_id: string
          p_limite?: number
          p_token_sha256: string
        }
        Returns: Json
      }
      atendimento_do_periodo: {
        Args: {
          p_ate: string
          p_clinic_id: string
          p_de: string
          p_de_anterior?: string
        }
        Returns: Json
      }
      apagar_mensagem: {
        Args: { p_escopo: string; p_message_id: string }
        Returns: Json
      }
      arquivar_e_limpar_mensagem: {
        Args: {
          p_escopo: string
          p_message_id: string
          p_origem: string
          p_por: string
        }
        Returns: undefined
      }
      automacao_fecha_ciclo: {
        Args: {
          p_clinic_id: string
          p_destinos: string[]
          p_etapa: string
          p_id: string
        }
        Returns: boolean
      }
      bater_ponto_do_worker: {
        Args: { p_ultimo_lote?: number; p_worker_id: string }
        Returns: undefined
      }
      cadastro_texto_valido: {
        Args: { p_maximo: number; p_texto: string }
        Returns: boolean
      }
      cancelar_pelo_paciente: {
        Args: {
          p_appointment_id: string
          p_clinic_id: string
          p_contact_id: string
          p_conversation_id?: string
        }
        Returns: Json
      }
      campanhas_do_periodo: {
        Args: {
          p_ate: string
          p_clinic_id: string
          p_de: string
          p_de_anterior?: string
        }
        Returns: Json
      }
      casar_clique_do_site: {
        Args: { p_clinic_id: string; p_codigo: string; p_contact_id: string }
        Returns: string
      }
      cancelar_reoferta_de_espera: {
        Args: { p_clinic_id: string; p_offer_id: string }
        Returns: boolean
      }
      cancelar_venda_de_pacote: {
        Args: { p_balance_id: string; p_reason: string }
        Returns: undefined
      }
      claim_jobs: {
        Args: { p_limit?: number; p_worker: string }
        Returns: {
          attempts: number
          clinic_id: string
          created_at: string
          devolucoes: number
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          prioridade: number
          run_at: string
          status: string
          ultimo_motivo_devolucao: string | null
          updated_at: string
          whatsapp_account_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "job_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_jobs_da_ia: {
        Args: {
          p_clinic_ids: string[]
          p_incluir_teste?: boolean
          p_max: number
          p_worker: string
        }
        Returns: {
          attempts: number
          clinic_id: string
          created_at: string
          devolucoes: number
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          prioridade: number
          run_at: string
          status: string
          ultimo_motivo_devolucao: string | null
          updated_at: string
          whatsapp_account_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "job_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_jobs_por_clinica: {
        Args: {
          p_incluir_teste?: boolean
          p_kinds: string[]
          p_max_clinicas: number
          p_worker: string
        }
        Returns: {
          attempts: number
          clinic_id: string
          created_at: string
          devolucoes: number
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          prioridade: number
          run_at: string
          status: string
          ultimo_motivo_devolucao: string | null
          updated_at: string
          whatsapp_account_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "job_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chave_de_especialidade: { Args: { p_texto: string }; Returns: string }
      chave_de_etiqueta: { Args: { p_texto: string }; Returns: string }
      chave_telefone: { Args: { p_phone: string }; Returns: string }
      chaves_de_etiqueta_do_contato: {
        Args: { p_contact_id: string }
        Returns: string[]
      }
      chaves_de_etiquetas: {
        Args: { p_etiquetas: string[] }
        Returns: string[]
      }
      clinica_esta_suspensa: { Args: { p_clinic_id: string }; Returns: boolean }
      concluir_job: {
        Args: { p_id: string; p_worker: string }
        Returns: undefined
      }
      conta_de_envio: {
        Args: { p_clinic_id: string; p_contact_id: string; p_tipo?: string }
        Returns: string
      }
      contas_de_envio: {
        Args: { p_clinic_id: string; p_contact_ids: string[]; p_tipo?: string }
        Returns: {
          connection_status: string
          contact_id: string
          nome: string
          whatsapp_account_id: string
        }[]
      }
      contato_tem_sinal_de_paciente: {
        Args: { p_clinic_id: string; p_phone_key: string }
        Returns: boolean
      }
      contato_do_job: {
        Args: { p_clinic_id: string; p_payload: Json }
        Returns: string
      }
      conferir_horario_da_ia: {
        Args: {
          p_clinic_id: string
          p_conversation_id: string
          p_ends_at: string
          p_reserva_propria: string
          p_service_link_id: string
          p_starts_at: string
          p_unit_id: string
        }
        Returns: Record<string, unknown>
      }
      confirmar_pelo_paciente: {
        Args: {
          p_appointment_id: string
          p_clinic_id: string
          p_contact_id: string
          p_conversation_id?: string
        }
        Returns: Json
      }
      confirmar_posse_job: {
        Args: { p_id: string; p_worker: string }
        Returns: boolean
      }
      aceitar_oferta_de_espera: {
        Args: {
          p_clinic_id: string
          p_contact_id: string
          p_conversation_id?: string
          p_offer_id: string
        }
        Returns: Json
      }
      consentimento_vigente: {
        Args: { p_channel?: string; p_clinic_id: string; p_contact_id: string }
        Returns: boolean
      }
      consulta_foi_confirmada: {
        Args: { p_canal: string; p_status: string }
        Returns: boolean
      }
      conta_por_email: {
        Args: { p_email: string }
        Returns: {
          confirmada: boolean
          user_id: string
        }[]
      }
      contagem_de_atividades: { Args: { p_clinic_id: string }; Returns: Json }
      contagem_de_etiquetas_de_conversa: {
        Args: { p_clinic_id: string }
        Returns: {
          chave: string
          total: number
        }[]
      }
      conversoes_devolvidas_da_clinica: {
        Args: { p_clinic_id: string }
        Returns: Json
      }
      cpf_valido: { Args: { p_cpf: string }; Returns: boolean }
      criar_oferta_de_espera: {
        Args: {
          p_clinic_id: string
          p_destinatarios: Json
          p_expires_at: string
          p_professional_id: string
          p_slot_ends_at: string
          p_slot_starts_at: string
          p_source_appointment_id: string
        }
        Returns: string
      }
      dados_que_faltam_para_marcar: {
        Args: {
          p_carteirinha: string
          p_clinic_id: string
          p_cpf: string
          p_data_nascimento: string
          p_nome_completo: string
          p_service_link_id: string
        }
        Returns: string[]
      }
      definir_contato_liberado_da_ia: {
        Args: {
          p_ativo: boolean
          p_clinic_id: string
          p_confirmou_aviso_da_openai?: boolean
          p_confirmou_teste_com_paciente?: boolean
          p_forcar_contato_existente?: boolean
          p_rotulo: string
          p_telefone_e164: string
        }
        Returns: boolean
      }
      definir_pausa_da_ia: {
        Args: { p_clinic_id: string; p_motivo: string; p_pausada: boolean }
        Returns: boolean
      }
      definir_agente_da_clinica: {
        Args: { p_clinic_id: string; p_estado: string; p_motivo: string }
        Returns: undefined
      }
      definir_agente_da_clinica_no_painel: {
        Args: {
          p_clinic_id: string
          p_estado: string
          p_estado_visto: string
          p_motivo: string
        }
        Returns: undefined
      }
      definir_instrucoes_do_agente: {
        Args: { p_clinic_id: string; p_instrucoes: string }
        Returns: undefined
      }
      definir_interruptor_da_ia: {
        Args: { p_ligado: boolean; p_motivo?: string }
        Returns: boolean
      }
      definir_liberacao_da_ia: {
        Args: {
          p_clinic_id: string
          p_liberada: boolean
          p_modo?: string
          p_motivo?: string
        }
        Returns: boolean
      }
      definir_numero_da_ia: {
        Args: {
          p_ativo: boolean
          p_clinic_id: string
          p_whatsapp_account_id: string
        }
        Returns: boolean
      }
      definir_teto_da_ia: {
        Args: {
          p_clinic_id: string
          p_teto_diario_centavos_usd: number
          p_teto_respostas_por_conversa_hora: number
        }
        Returns: undefined
      }
      definir_numero_principal: {
        Args: { p_account_id: string; p_clinic_id: string }
        Returns: string
      }
      deixar_de_ser_implementador: {
        Args: { p_clinic_id: string; p_papel_novo: string; p_user_id: string }
        Returns: undefined
      }
      devolver_conversa_da_consulta_recusada: {
        Args: { p_appointment_id: string; p_clinic_id: string }
        Returns: boolean
      }
      definir_entrada_por_codigo: {
        Args: { p_ativo: boolean; p_clinic_id: string }
        Returns: boolean
      }
      expirar_ofertas_de_espera: { Args: never; Returns: number }
      enfileirar_gasto_meta_do_dia: {
        Args: {
          p_agora?: string
          p_clinic_ids?: string[]
          p_incluir_teste?: boolean
          p_limite?: number
        }
        Returns: number
      }
      enfileirar_resolucao_de_anuncios_meta: {
        Args: {
          p_clinic_id: string
          p_incluir_teste?: boolean
          p_origem: string
          p_run_at?: string
        }
        Returns: Json
      }
      enfileirar_sincronizacao_de_gasto_meta: {
        Args: {
          p_agora?: string
          p_clinic_id: string
          p_incluir_teste?: boolean
          p_origem: string
        }
        Returns: Json
      }
      encerrar_agendada_sem_envio: {
        Args: { p_agendada_id: string; p_motivo: string; p_situacao: string }
        Returns: boolean
      }
      encerrar_envios_da_oferta: {
        Args: { p_clinic_id: string; p_offer_id: string }
        Returns: number
      }
      devolver_para_ia: { Args: { p_conversation_id: string }; Returns: Json }
      disparar_ciclo_da_ia: { Args: never; Returns: boolean }
      disparar_ciclo_do_motor: { Args: never; Returns: undefined }
      enfileirar_resposta_da_ia: {
        Args: {
          p_clinic_id: string
          p_conversation_id: string
          p_incluir_teste?: boolean
          p_message_id: string
        }
        Returns: Json
      }
      emails_da_equipe: {
        Args: { p_clinic_id: string }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      entrar_como_implementador: {
        Args: {
          p_clinic_id: string
          p_papel_lido?: string
          p_situacao_lida?: string
          p_user_id: string
        }
        Returns: string
      }
      equipe_da_clinica_no_painel: {
        Args: { p_clinic_id: string }
        Returns: Json
      }
      escrever_nota_da_clinica: {
        Args: { p_clinic_id: string; p_texto: string }
        Returns: string
      }
      espera_pelo_celular_sem_linha: {
        Args: {
          p_base: string
          p_clinic_id: string
          p_phone_e164: string
          p_whatsapp_account_id: string
        }
        Returns: string
      }
      excluir_contato_liberado_da_ia: {
        Args: { p_clinic_id: string; p_contato_liberado_id: string }
        Returns: boolean
      }
      excluir_nota_da_clinica: {
        Args: { p_nota_id: string }
        Returns: undefined
      }
      etiquetar_contatos: {
        Args: {
          p_adicionar: string[]
          p_clinic_id: string
          p_contact_ids: string[]
          p_remover: string[]
        }
        Returns: number
      }
      etiquetar_conversa: {
        Args: {
          p_adicionar?: string[]
          p_clinic_id: string
          p_conversation_id: string
          p_remover?: string[]
        }
        Returns: string[]
      }
      etiquetas_casam: {
        Args: {
          p_chaves_do_contato: string[]
          p_etiquetas: string[]
          p_modo: string
        }
        Returns: boolean
      }
      etiquetas_validas: { Args: { p_etiquetas: string[] }; Returns: boolean }
      executar_automacoes_de_fluxo: {
        Args: {
          p_clinic_id?: string
          p_incluir_teste?: boolean
          p_limite?: number
        }
        Returns: Json
      }
      falhar_job: {
        Args: {
          p_definitivo: boolean
          p_erro: string
          p_id: string
          p_worker: string
        }
        Returns: undefined
      }
      faturamento_do_periodo: {
        Args: {
          p_ate: string
          p_clinic_id: string
          p_de: string
          p_de_anterior?: string
        }
        Returns: Json
      }
      fechar_execucoes_pela_metade: {
        Args: { p_automacao_id: string }
        Returns: number
      }
      fechar_runs_orfas: { Args: never; Returns: number }
      frase_de_escalonamento_da_ia: { Args: never; Returns: string }
      frases_do_rastreio: { Args: { p_chave: string }; Returns: string[] }
      followups_devidos: {
        Args: { p_clinic_id?: string }
        Returns: {
          clinic_id: string
          contact_id: string
          scheduled_for: string
          step_id: string
        }[]
      }
      funil_da_jornada: { Args: { p_clinic_id: string }; Returns: Json }
      funil_do_periodo: {
        Args: {
          p_ate: string
          p_clinic_id: string
          p_de: string
          p_de_anterior?: string
        }
        Returns: Json
      }
      garantir_conversa_aberta: {
        Args: {
          p_clinic_id: string
          p_contact_id: string
          p_whatsapp_account_id?: string
        }
        Returns: string
      }
      garantir_rascunho_do_agente: {
        Args: { p_clinic_id: string }
        Returns: string
      }
      gravar_atendimento_da_ia: {
        Args: {
          p_clinic_id: string
          p_conversation_id: string
          p_estado: Json
          p_job_id: string
          p_versao: number
        }
        Returns: Json
      }
      gravar_evento_da_ia: {
        Args: { p_job_id: string; p_motivo: string; p_worker: string }
        Returns: boolean
      }
      gravar_resolucao_de_anuncios_meta: {
        Args: {
          p_ad_account_id: string
          p_clinic_id: string
          p_job_id: string
          p_recusas: Json
          p_resolvidos: Json
          p_token_sha256: string
          p_worker: string
        }
        Returns: string
      }
      historico_da_clinica_no_painel: {
        Args: { p_clinic_id: string; p_limite?: number }
        Returns: Json
      }
      horario_de_funcionamento_valido: {
        Args: { p_horario: Json }
        Returns: boolean
      }
      ia_atende_no_whatsapp: {
        Args: {
          p_clinic_id: string
          p_telefone: string
          p_whatsapp_account_id: string
        }
        Returns: boolean
      }
      ia_clinica_liberada: { Args: { p_clinic_id: string }; Returns: boolean }
      ia_clinicas_da_fase_controlada: { Args: never; Returns: string[] }
      ia_desligar: { Args: { p_clinic_ids: string[] }; Returns: Json }
      ia_devolver_disponivel: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      ia_estado_do_motor: { Args: never; Returns: Json }
      ia_exigir_equipe_conduzza: { Args: never; Returns: undefined }
      ia_estado_do_atendimento: {
        Args: { p_linha: Database["public"]["Tables"]["ia_atendimento"]["Row"] }
        Returns: Json
      }
      ia_estado_do_atendimento_valido: {
        Args: { p_estado: Json }
        Returns: boolean
      }
      ia_exigir_quem_libera: {
        Args: { p_clinic_id: string }
        Returns: undefined
      }
      ia_horario_do_assistente: {
        Args: { p_agora?: string; p_clinic_id: string }
        Returns: string
      }
      ia_interruptor_ligado: { Args: never; Returns: boolean }
      ia_horarios_oferecidos_validos: {
        Args: { p_horarios: Json }
        Returns: boolean
      }
      ia_jobs_devidos: {
        Args: {
          p_clinic_ids: string[]
          p_folga: string
          p_incluir_teste: boolean
        }
        Returns: string[]
      }
      ia_liberacao_vigente: {
        Args: { p_clinic_id: string; p_modos: string[] }
        Returns: boolean
      }
      ia_marcar_respondida: {
        Args: { p_job_id: string; p_worker: string }
        Returns: boolean
      }
      ia_membro_ve_a_liberacao: {
        Args: { p_clinic_id: string }
        Returns: boolean
      }
      ia_pode_atender: {
        Args: {
          p_clinic_id: string
          p_phone_key: string
          p_whatsapp_account_id: string
        }
        Returns: boolean
      }
      ia_pode_enviar_agora: {
        Args: {
          p_conversation_id: string
          p_job_id: string
          p_telefone: string
          p_tipo: string
          p_whatsapp_account_id: string
          p_worker: string
        }
        Returns: string
      }
      ia_pode_falar_com: {
        Args: {
          p_clinic_id: string
          p_telefone: string
          p_whatsapp_account_id: string
        }
        Returns: boolean
      }
      ia_pode_simular: { Args: { p_clinic_id: string }; Returns: boolean }
      ia_publico_aceita: {
        Args: { p_clinic_id: string; p_telefone: string }
        Returns: boolean
      }
      ia_retomar_conversas_no_horario: {
        Args: { p_incluir_teste?: boolean; p_limite?: number }
        Returns: Json
      }
      ia_tirar_conversa: {
        Args: {
          p_aguardando: boolean
          p_conversation_id: string
          p_motivo: string
        }
        Returns: boolean
      }
      ingest_inbound_message: {
        Args: {
          p_body?: string
          p_clinic_id: string
          p_content_type?: string
          p_media_filename?: string
          p_media_mimetype?: string
          p_media_url?: string
          p_name: string
          p_phone_e164: string
          p_transcript?: string
          p_wa_message_id: string
          p_whatsapp_account_id?: string
        }
        Returns: Json
      }
      instrucoes_do_agente: { Args: { p_clinic_id: string }; Returns: string }
      is_product_admin: { Args: never; Returns: boolean }
      ler_atendimento_da_ia: {
        Args: {
          p_clinic_id: string
          p_conversation_id: string
          p_job_id: string
        }
        Returns: Json
      }
      ler_dados_informados_na_marcacao: {
        Args: { p_appointment_id: string; p_clinic_id: string }
        Returns: Json
      }
      ler_rascunho_bloqueado: {
        Args: { p_decision_id: string }
        Returns: Json
      }
      limpar_holds_vencidos: { Args: never; Returns: number }
      marcar_aguardando_confirmacao: {
        Args: { p_appointment_id: string; p_clinic_id: string }
        Returns: Json
      }
      marcar_eco_para_termo: {
        Args: { p_clinic_id: string; p_wa_message_id: string }
        Returns: boolean
      }
      metricas_da_espera: {
        Args: { p_clinic_id: string }
        Returns: {
          primeira_onda_aceita: number
          primeira_onda_base: number
          receita_cents: number
          tempo_medio_min: number
          vagas_canceladas: number
          vagas_cobertas: number
          vagas_com_valor: number
          vagas_em_andamento: number
          vagas_esgotadas: number
          vagas_oferecidas: number
          vagas_preenchidas: number
          vagas_sem_preco: number
        }[]
      }
      metricas_de_pacientes: {
        Args: { p_clinic_id: string }
        Returns: {
          ativos: number
          ativos_30d_atras: number
          novos_no_mes: number
          primeiro_comparecimento: string
          retorno_base: number
          retorno_voltaram: number
          sem_contato_6m: number
        }[]
      }
      midia_mensagem_do_caminho: {
        Args: { p_caminho: string }
        Returns: string
      }
      minhas_clinicas_pendentes: {
        Args: never
        Returns: {
          clinic_id: string
          clinic_name: string
        }[]
      }
      minhas_clinicas_suspensas: {
        Args: never
        Returns: {
          clinic_id: string
          nome: string
          suspensa_em: string
        }[]
      }
      motor_agendar: { Args: never; Returns: string }
      motor_desagendar: { Args: never; Returns: string }
      motor_ia_agendar: { Args: never; Returns: string }
      motor_ia_desagendar: { Args: never; Returns: string }
      motivo_da_agendada: { Args: { p_codigo: string }; Returns: string }
      motor_manutencao: { Args: never; Returns: Json }
      mover_lead_para_aguardando: {
        Args: {
          p_clinic_id: string
          p_contact_id: string
          p_conversation_id: string
          p_da_pendencia?: boolean
        }
        Returns: string
      }
      notas_da_clinica_no_painel: {
        Args: { p_clinic_id: string; p_limite?: number }
        Returns: Json
      }
      numero_do_job: {
        Args: { p_job_id: string; p_worker: string }
        Returns: Json
      }
      mover_na_lista_de_espera: {
        Args: { p_clinic_id: string; p_id: string; p_nova_posicao: number }
        Returns: string
      }
      ordenar_reguas_de_followup: {
        Args: { p_clinic_id: string; p_ids: string[]; p_trigger_stage: string }
        Returns: undefined
      }
      passar_conversa_da_ia_para_equipe: {
        Args: { p_job_id: string; p_motivo: string; p_worker: string }
        Returns: Json
      }
      pedir_remarcacao_pelo_paciente: {
        Args: {
          p_appointment_id: string
          p_clinic_id: string
          p_contact_id: string
          p_conversation_id?: string
        }
        Returns: Json
      }
      painel_cs_das_clinicas: {
        Args: { p_incluir_teste?: boolean }
        Returns: Json
      }
      painel_geral_das_clinicas: {
        Args: { p_incluir_teste?: boolean }
        Returns: Json
      }
      pacientes_resumo: {
        Args: { p_clinic_id: string }
        Returns: {
          contact_id: string
          insurance_id: string
          insurance_name: string
          name: string
          no_show_count: number
          phone_e164: string
          primeira_consulta: string
          profissionais_ids: string[]
          proxima_consulta: string
          saldo_sessoes: number
          saldo_total: number
          tags: string[]
          total_compareceu: number
          total_faltou: number
          ultima_consulta: string
        }[]
      }
      planejar_automacoes_de_fluxo: {
        Args: {
          p_clinic_id?: string
          p_incluir_teste?: boolean
          p_limite?: number
        }
        Returns: number
      }
      planejar_mensagens_agendadas: {
        Args: {
          p_clinic_id?: string
          p_incluir_teste?: boolean
          p_limite?: number
        }
        Returns: Json
      }
      planejar_reguas: { Args: never; Returns: Json }
      podar_agendamento_da_ia: { Args: never; Returns: Json }
      podar_cliques_do_site: {
        Args: { p_agora?: string; p_clinic_ids?: string[] }
        Returns: Json
      }
      previa_da_automacao_de_fluxo: {
        Args: {
          p_clinic_id: string
          p_espera_minutos?: number
          p_etapa: string
          p_gatilho: string
        }
        Returns: Json
      }
      processar_pendencias_do_funil: {
        Args: {
          p_clinic_id?: string
          p_incluir_teste?: boolean
          p_limite?: number
        }
        Returns: Json
      }
      prontidao_do_cadastro_da_ia: {
        Args: { p_clinic_id: string }
        Returns: Json
      }
      publicar_agente: {
        Args: { p_autor: string; p_clinic_id: string; p_conferido_em: string }
        Returns: Json
      }
      recusar_oferta_de_espera: {
        Args: { p_clinic_id: string; p_contact_id: string; p_offer_id: string }
        Returns: Json
      }
      reordenar_etapa_da_jornada: {
        Args: { p_chave: string; p_clinic_id: string; p_direcao: string }
        Returns: string
      }
      pode_apagar_mensagem: {
        Args: { p_escopo: string; p_message_id: string }
        Returns: Json
      }
      reagendar_job: {
        Args: {
          p_id: string
          p_motivo?: string
          p_run_at: string
          p_worker: string
        }
        Returns: boolean
      }
      reativar_clinica: {
        Args: { p_clinic_id: string; p_motivo: string }
        Returns: Json
      }
      recalcular_previa_da_conversa: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      reconciliar_mensagem_agendada: {
        Args: { p_agendada_id: string }
        Returns: string
      }
      reconciliar_mensagens_agendadas: {
        Args: {
          p_clinic_id?: string
          p_incluir_teste?: boolean
          p_limite?: number
        }
        Returns: Json
      }
      reclassificar_resposta_automatica: {
        Args: {
          p_clinic_id: string
          p_enviada_em?: string
          p_message_id: string
        }
        Returns: number
      }
      redistribuir_jobs_do_numero: {
        Args: { p_account_id: string; p_tipos?: string[] }
        Returns: number
      }
      regua_da_consulta: {
        Args: { p_appointment_id: string; p_kind: string }
        Returns: string
      }
      regua_de_followup_do_contato: {
        Args: { p_contact_id: string }
        Returns: string
      }
      regravar_gasto_meta: {
        Args: {
          p_ad_account_id: string
          p_ate: string
          p_clinic_id: string
          p_conta_ativa: boolean
          p_da_conta: Json
          p_desde: string
          p_fuso: string
          p_job_id: string
          p_moeda: string
          p_nome_da_conta: string
          p_por_anuncio: Json
          p_token_sha256: string
          p_worker: string
        }
        Returns: string
      }
      registrar_clique_do_site: {
        Args: {
          p_chave: string
          p_codigo: string
          p_gad_source?: string
          p_gbraid?: string
          p_gclid?: string
          p_google_adgroup_id?: string
          p_google_campaign_id?: string
          p_site_host?: string
          p_wbraid?: string
        }
        Returns: string
      }
      registrar_anuncio_do_whatsapp: {
        Args: {
          p_ad_id: string
          p_clinic_id: string
          p_descricao?: string
          p_link?: string
          p_plataforma?: string
          p_tipo?: string
          p_titulo?: string
          p_visto_em?: string
        }
        Returns: string
      }
      registrar_apagamento_do_whatsapp: {
        Args: {
          p_clinic_id: string
          p_wa_message_id: string
          p_whatsapp_account_id?: string
        }
        Returns: Json
      }
      registrar_dados_da_marcacao: {
        Args: {
          p_carteirinha?: string
          p_clinic_id: string
          p_conversation_id: string
          p_cpf?: string
          p_data_nascimento?: string
          p_job_id: string
          p_nome_completo?: string
          p_para_o_titular: boolean
        }
        Returns: Json
      }
      registrar_falha_do_gasto_meta: {
        Args: {
          p_ad_account_id: string
          p_clinic_id: string
          p_codigo?: number
          p_job_id: string
          p_problema: string
          p_token_sha256: string
          p_worker: string
        }
        Returns: string
      }
      registrar_mensagem_do_celular: {
        Args: {
          p_body?: string
          p_clinic_id: string
          p_content_type?: string
          p_enviada_em?: string
          p_media_filename?: string
          p_media_mimetype?: string
          p_media_url?: string
          p_phone_e164: string
          p_quoted_wa_message_id?: string
          p_wa_message_id: string
          p_whatsapp_account_id: string
        }
        Returns: Json
      }
      registrar_requisito_da_producao: {
        Args: { p_chave: string; p_clinic_id?: string; p_evidencia: string }
        Returns: string
      }
      remover_numero: {
        Args: {
          p_account_id: string
          p_clinic_id: string
          p_removido_por?: string
        }
        Returns: Json
      }
      requisitos_da_producao: {
        Args: { p_clinic_id: string }
        Returns: Json
      }
      reservar_gasto_da_ia: {
        Args: {
          p_clinic_id: string
          p_custo_microdolar: number
          p_origem: string
        }
        Returns: string
      }
      reservar_horario_da_ia: {
        Args: {
          p_clinic_id: string
          p_conversation_id: string
          p_job_id: string
          p_service_link_id: string
          p_starts_at: string
          p_unit_id?: string
        }
        Returns: Json
      }
      reservar_slot_envio_v2: {
        Args: {
          p_clinic_id: string
          p_espaco_curto_ms?: number
          p_espaco_ms: number
          p_espera_maxima_ms: number
          p_massa?: boolean
          p_whatsapp_account_id?: string
        }
        Returns: Json
      }
      rotulo_do_motivo_da_ia: { Args: { p_motivo: string }; Returns: string }
      resolver_conta_de_envio: {
        Args: { p_clinic_id: string; p_contact_id: string; p_tipo?: string }
        Returns: string
      }
      restaurar_versao_do_agente: {
        Args: { p_clinic_id: string; p_versao: number }
        Returns: string
      }
      resumo_do_dia: {
        Args: {
          p_clinic_id: string
          p_fim: string
          p_inicios: string[]
          p_semana_passada_ate: string
          p_semana_passada_de: string
        }
        Returns: Json
      }
      revogar_requisito_da_producao: {
        Args: { p_id: string; p_motivo: string }
        Returns: Json
      }
      salvar_automacao_de_fluxo: {
        Args: { p_clinic_id: string; p_id: string; p_regra: Json }
        Returns: string
      }
      salvar_pacote: {
        Args: {
          p_active: boolean
          p_clinic_id: string
          p_itens: Json
          p_name: string
          p_package_id?: string
          p_price_cents: number
          p_validity_days: number
        }
        Returns: string
      }
      salvar_requisitos_do_procedimento: {
        Args: {
          p_ids_na_abertura: string[]
          p_itens: Json
          p_procedure_id: string
        }
        Returns: Json
      }
      saude_do_motor: { Args: never; Returns: Json }
      seed_reguas_padrao: { Args: { p_clinic_id: string }; Returns: undefined }
      serie_diaria_do_periodo: {
        Args: { p_ate: string; p_clinic_id: string; p_de: string }
        Returns: Json
      }
      situacao_da_ia_na_clinica: {
        Args: { p_clinic_id: string }
        Returns: Json
      }
      situacao_do_rastreio: { Args: { p_clinic_id: string }; Returns: Json }
      sincronizar_convenios_do_profissional: {
        Args: {
          p_confirmar?: boolean
          p_convenios: string[]
          p_convenios_na_abertura?: string[]
          p_professional_id: string
        }
        Returns: Json
      }
      sincronizar_vinculos_do_procedimento: {
        Args: {
          p_confirmar?: boolean
          p_linhas: Json
          p_planos?: string[]
          p_planos_na_abertura?: string[]
          p_procedure_id: string
          p_vinculos_na_abertura?: Json
        }
        Returns: Json
      }
      substituir_jornada: {
        Args: { p_clinic_id: string; p_faixas: Json; p_professional_id: string }
        Returns: undefined
      }
      suspender_clinica: {
        Args: { p_clinic_id: string; p_motivo: string }
        Returns: undefined
      }
      telefone_e_numero_da_plataforma: {
        Args: { p_telefone: string }
        Returns: boolean
      }
      tipo_de_envio_do_job: {
        Args: { p_kind: string; p_payload: Json }
        Returns: string
      }
      tirar_conversa_da_ia_pelo_servidor: {
        Args: {
          p_clinic_id: string
          p_conversation_id: string
          p_job_id?: string
          p_motivo: string
        }
        Returns: boolean
      }
      tirar_agendada_para_enviar_agora: {
        Args: { p_id: string }
        Returns: Json
      }
      trocar_chave_do_rastreio: {
        Args: { p_clinic_id: string }
        Returns: string
      }
      user_active_clinic_ids: { Args: never; Returns: string[] }
      user_can_write: { Args: { p_clinic_id: string }; Returns: boolean }
      user_clinic_ids: { Args: never; Returns: string[] }
      user_e_admin_pleno: { Args: { p_clinic_id: string }; Returns: boolean }
      user_e_implementador: { Args: { p_clinic_id: string }; Returns: boolean }
      user_has_role: {
        Args: { p_clinic_id: string; p_roles: string[] }
        Returns: boolean
      }
      uso_dos_pacotes: {
        Args: { p_clinic_id: string }
        Returns: {
          package_id: string
          pacientes_com_saldo: number
          vendas: number
        }[]
      }
      vaga_de_espera_indisponivel: {
        Args: {
          p_clinic_id: string
          p_ends_at: string
          p_professional_id: string
          p_starts_at: string
          p_unit_id?: string
        }
        Returns: string
      }
      user_professional_id: { Args: { p_clinic_id: string }; Returns: string }
      validar_codigo_clinica: { Args: { p_codigo: string }; Returns: Json }
      vender_pacote: {
        Args: {
          p_contact_id: string
          p_inicio?: string
          p_package_id: string
          p_usadas?: Json
        }
        Returns: string
      }
      vincular_citacao_recebida: {
        Args: {
          p_clinic_id: string
          p_message_id: string
          p_quoted_wa_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

