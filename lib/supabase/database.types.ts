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
      ai_decision_log: {
        Row: {
          blocked_draft: string | null
          clinic_id: string
          compliance_blocked: boolean
          compliance_rule: string | null
          context_read: Json | null
          conversation_id: string
          created_at: string
          escalation_reason: string | null
          id: string
          latency_ms: number | null
          message_id: string | null
          tool_used: string | null
        }
        Insert: {
          blocked_draft?: string | null
          clinic_id: string
          compliance_blocked?: boolean
          compliance_rule?: string | null
          context_read?: Json | null
          conversation_id: string
          created_at?: string
          escalation_reason?: string | null
          id?: string
          latency_ms?: number | null
          message_id?: string | null
          tool_used?: string | null
        }
        Update: {
          blocked_draft?: string | null
          clinic_id?: string
          compliance_blocked?: boolean
          compliance_rule?: string | null
          context_read?: Json | null
          conversation_id?: string
          created_at?: string
          escalation_reason?: string | null
          id?: string
          latency_ms?: number | null
          message_id?: string | null
          tool_used?: string | null
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
      automacao_fluxo: {
        Row: {
          acao: string
          ativa: boolean
          atividade_prazo_dias: number | null
          atividade_titulo: string | null
          clinic_id: string
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
          acao: string
          ativa?: boolean
          atividade_prazo_dias?: number | null
          atividade_titulo?: string | null
          clinic_id: string
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
          acao?: string
          ativa?: boolean
          atividade_prazo_dias?: number | null
          atividade_titulo?: string | null
          clinic_id?: string
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
          for_no_show_history: boolean
          id: string
          kind: string
          name: string
          no_show_threshold: number
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
          for_no_show_history?: boolean
          id?: string
          kind: string
          name: string
          no_show_threshold?: number
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
          for_no_show_history?: boolean
          id?: string
          kind?: string
          name?: string
          no_show_threshold?: number
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
          error_code: string | null
          id: string
          is_internal_note: boolean
          job_id: string | null
          media_filename: string | null
          media_mimetype: string | null
          media_url: string | null
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
          error_code?: string | null
          id?: string
          is_internal_note?: boolean
          job_id?: string | null
          media_filename?: string | null
          media_mimetype?: string | null
          media_url?: string | null
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
          error_code?: string | null
          id?: string
          is_internal_note?: boolean
          job_id?: string | null
          media_filename?: string | null
          media_mimetype?: string | null
          media_url?: string | null
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
          adset_id: string | null
          atualizado_em: string
          campaign_id: string
          campaign_name: string | null
          clinic_id: string
          ultimo_dia_com_entrega: string
        }
        Insert: {
          ad_account_id: string
          ad_id: string
          adset_id?: string | null
          atualizado_em?: string
          campaign_id: string
          campaign_name?: string | null
          clinic_id: string
          ultimo_dia_com_entrega: string
        }
        Update: {
          ad_account_id?: string
          ad_id?: string
          adset_id?: string | null
          atualizado_em?: string
          campaign_id?: string
          campaign_name?: string | null
          clinic_id?: string
          ultimo_dia_com_entrega?: string
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
          id: string
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
          id?: string
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
          id?: string
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
          clinic_id: string
          contact_id: string | null
          created_at: string
          created_by: string
          ends_at: string
          expires_at: string
          id: string
          professional_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string
          ends_at: string
          expires_at: string
          id?: string
          professional_id: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string
          ends_at?: string
          expires_at?: string
          id?: string
          professional_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
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
            foreignKeyName: "slot_hold_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
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
          active: boolean
          address: string | null
          clinic_id: string
          created_at: string
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          clinic_id: string
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          clinic_id?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
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
      bater_ponto_do_worker: {
        Args: { p_ultimo_lote?: number; p_worker_id: string }
        Returns: undefined
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
      chave_telefone: { Args: { p_phone: string }; Returns: string }
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
      contato_do_job: {
        Args: { p_clinic_id: string; p_payload: Json }
        Returns: string
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
      definir_numero_principal: {
        Args: { p_account_id: string; p_clinic_id: string }
        Returns: string
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
      enfileirar_sincronizacao_de_gasto_meta: {
        Args: {
          p_agora?: string
          p_clinic_id: string
          p_incluir_teste?: boolean
          p_origem: string
        }
        Returns: Json
      }
      encerrar_envios_da_oferta: {
        Args: { p_clinic_id: string; p_offer_id: string }
        Returns: number
      }
      disparar_ciclo_do_motor: { Args: never; Returns: undefined }
      emails_da_equipe: {
        Args: { p_clinic_id: string }
        Returns: {
          email: string
          user_id: string
        }[]
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
      fechar_runs_orfas: { Args: never; Returns: number }
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
      is_product_admin: { Args: never; Returns: boolean }
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
      motor_agendar: { Args: never; Returns: string }
      motor_desagendar: { Args: never; Returns: string }
      motor_manutencao: { Args: never; Returns: Json }
      numero_do_job: {
        Args: { p_job_id: string; p_worker: string }
        Returns: Json
      }
      mover_na_lista_de_espera: {
        Args: { p_clinic_id: string; p_id: string; p_nova_posicao: number }
        Returns: string
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
      planejar_reguas: { Args: never; Returns: Json }
      previa_da_automacao_de_fluxo: {
        Args: {
          p_clinic_id: string
          p_espera_minutos?: number
          p_etapa: string
          p_gatilho: string
        }
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
      recalcular_previa_da_conversa: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      redistribuir_jobs_do_numero: {
        Args: { p_account_id: string; p_tipos?: string[] }
        Returns: number
      }
      regua_da_consulta: {
        Args: { p_appointment_id: string; p_kind: string }
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
      registrar_apagamento_do_whatsapp: {
        Args: {
          p_clinic_id: string
          p_wa_message_id: string
          p_whatsapp_account_id?: string
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
      remover_numero: {
        Args: {
          p_account_id: string
          p_clinic_id: string
          p_removido_por?: string
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
      resolver_conta_de_envio: {
        Args: { p_clinic_id: string; p_contact_id: string; p_tipo?: string }
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
      saude_do_motor: { Args: never; Returns: Json }
      seed_reguas_padrao: { Args: { p_clinic_id: string }; Returns: undefined }
      serie_diaria_do_periodo: {
        Args: { p_ate: string; p_clinic_id: string; p_de: string }
        Returns: Json
      }
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
      tipo_de_envio_do_job: {
        Args: { p_kind: string; p_payload: Json }
        Returns: string
      }
      user_active_clinic_ids: { Args: never; Returns: string[] }
      user_can_write: { Args: { p_clinic_id: string }; Returns: boolean }
      user_clinic_ids: { Args: never; Returns: string[] }
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

