const json = (await response.json()) as { messages?: { id: string }[]; [key: string]: unknown };

    if (!response.ok) {
      throw new Error(`Falha ao enviar mensagem WhatsApp: ${JSON.stringify(json)}`);
    }

    return json.messages?.[0]?.id;
